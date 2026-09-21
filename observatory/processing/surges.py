"""Trade-surge screening — sudden rises in extra-EU imports/exports by partner.

Pure screening logic in `screen()` (unit-tested); `compute()` writes one
`trade_surge` indicator row per hit and upserts recent hits into `alert`, the
durable table the notifier reads (fact_indicator is rebuilt every night, so
'already notified' cannot live there).
"""
import json
import logging
from collections import defaultdict
from statistics import mean

from observatory.settings import load_config

log = logging.getLogger(__name__)

INDICATOR = "trade_surge"
EU_MEMBERS = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL",
              "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
              "ES", "SE"}


def _severity(ratio, share, sev_cfg):
    if (ratio is not None and ratio >= sev_cfg["high_ratio"]) or \
       (share is not None and share >= sev_cfg["high_share"]):
        return "high"
    return "medium"


def screen(values, totals, thresholds, sev_cfg, aggregate=False):
    """Screen one monthly series.

    values: list of tonnes per month (chronological, missing months as 0)
    totals: list of extra-EU tonnes per month, same grid (share denominator)
    Returns a list of hits: {index, test, value, baseline, ratio, share, severity, new_origin}
    """
    hits = []
    n = len(values)
    m = thresholds["month"]
    for i in range(12, n):
        v = values[i]
        prior = values[i - 12:i]
        base_mean, base_max = mean(prior), max(prior)
        share = (v / totals[i]) if (not aggregate and totals[i]) else None
        if v < m["min_t"]:
            continue
        if not aggregate and (share is None or share < m["min_share"]):
            continue
        if v < m["ratio_vs_mean"] * base_mean or v < m["ratio_vs_max"] * base_max:
            continue
        ratio = v / base_mean if base_mean else None
        hits.append({"index": i, "test": "month", "value": v, "baseline": base_mean,
                     "ratio": ratio, "share": share, "new_origin": base_mean == 0,
                     "severity": _severity(ratio, share, sev_cfg)})
    q = thresholds["quarter"]
    for i in range(14, n):
        last3 = values[i - 2:i + 1]
        prior = values[i - 14:i - 2]
        v3, base = mean(last3), mean(prior)
        tot3 = sum(totals[i - 2:i + 1]) if not aggregate else None
        share = (sum(last3) / tot3) if tot3 else None
        if v3 < q["min_t"]:
            continue
        if not aggregate and (share is None or share < q["min_share"]):
            continue
        if v3 < q["ratio_vs_mean"] * base:
            continue
        ratio = v3 / base if base else None
        hits.append({"index": i, "test": "quarter", "value": v3, "baseline": base,
                     "ratio": ratio, "share": share, "new_origin": base == 0,
                     "severity": _severity(ratio, share, sev_cfg)})
    return hits


def _load_trade(conn):
    """{(product, flow): {partner: {period: tonnes}}} for the whole basket."""
    rows = conn.execute(
        """SELECT product_code, flow, partner_geo_id, period, value
           FROM v_series_latest
           WHERE series_id = 'trade.quantity' AND geo_id = 'EU27_2020'
             AND period LIKE '%-%'"""
    ).fetchall()
    data = defaultdict(lambda: defaultdict(dict))
    for r in rows:
        data[(r["product_code"], r["flow"])][r["partner_geo_id"]][r["period"]] = float(r["value"])
    return data


def screen_all(data, cfg):
    """Run the screen over every product/flow/partner. Returns list of hit dicts
    with product, flow, partner, period added (used by compute() and the backtest)."""
    excluded = set(cfg["excluded_partners"]) | EU_MEMBERS
    out = []
    for (product, flow), partners in data.items():
        total = partners.get("EXTRA_EU")
        if not total:
            continue
        months = sorted(total)
        totals = [total.get(p, 0.0) for p in months]
        agg_hits = screen(totals, totals, cfg["aggregate"], cfg["severity"], aggregate=True)
        for h in agg_hits:
            out.append({**h, "product": product, "flow": flow, "partner": "EXTRA_EU",
                        "period": months[h["index"]]})
        for partner, series in partners.items():
            if partner in excluded:
                continue
            values = [series.get(p, 0.0) for p in months]
            for h in screen(values, totals, cfg["partner"], cfg["severity"]):
                out.append({**h, "product": product, "flow": flow, "partner": partner,
                            "period": months[h["index"]]})
    return out


def _period_start(period):
    return f"{period}-01"


def compute(conn, run_id: int) -> int:
    cfg = load_config("surges")
    data = _load_trade(conn)
    hits = screen_all(data, cfg)
    # latest N periods per product/flow grid -> alert window
    latest = {}
    for (product, flow), partners in data.items():
        months = sorted(partners.get("EXTRA_EU", {}))
        latest[(product, flow)] = set(months[-cfg["alert_window_months"]:])
    n = 0
    for h in hits:
        inputs = {"flow": h["flow"], "partner": h["partner"], "test": h["test"],
                  "baseline_t": round(h["baseline"], 1), "ratio": h["ratio"] and round(h["ratio"], 2),
                  "share": h["share"] and round(h["share"], 3), "new_origin": h["new_origin"],
                  "severity": h["severity"], "methodology_version": cfg["methodology_version"],
                  "confirmed": cfg["confirmed"], "source": "Eurostat Comext (trade.quantity)"}
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, comparator_geo_id, product_code,
                period, period_start, value, unit, inputs, run_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (INDICATOR, cfg["methodology_version"], "EU27_2020", h["partner"], h["product"],
             h["period"], _period_start(h["period"]), round(h["value"], 1), "t",
             json.dumps(inputs), run_id),
        )
        n += 1
        if h["period"] in latest[(h["product"], h["flow"])]:
            conn.execute(
                """INSERT INTO alert (kind, product_code, flow, partner_geo_id, period, test,
                                      severity, value, inputs)
                   VALUES ('trade_surge', %s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (kind, product_code, flow, partner_geo_id, period, test)
                   DO UPDATE SET severity = EXCLUDED.severity, value = EXCLUDED.value,
                                 inputs = EXCLUDED.inputs, last_seen = now()""",
                (h["product"], h["flow"], h["partner"], h["period"], h["test"],
                 h["severity"], round(h["value"], 1), json.dumps(inputs)),
            )
    log.info("trade_surge: %d hits", n)
    return n


def partner_stats(series_by_partner, months, cfg=None):
    """Latest-month statistics per partner for the dashboard table (same maths as the
    screen): latest, 12-month mean/max, ratio, 3-month mean, share of the total."""
    cfg = cfg or load_config("surges")
    total = series_by_partner.get("EXTRA_EU", {})
    totals = [total.get(p, 0.0) for p in months]
    out = []
    for partner, series in series_by_partner.items():
        if partner in set(cfg["excluded_partners"]) | EU_MEMBERS:
            continue
        values = [series.get(p, 0.0) for p in months]
        if len(values) < 15:
            continue
        v, prior = values[-1], values[-13:-1]
        base = mean(prior)
        last3, prior12 = mean(values[-3:]), mean(values[-15:-3])
        hits = screen(values, totals, cfg["partner"], cfg["severity"])
        flags = sorted({h["test"] for h in hits if h["index"] >= len(values) - 3})
        out.append({"geo": partner, "latest": v, "mean12": base, "max12": max(prior),
                    "ratio": (v / base) if base else None, "avg3": last3,
                    "ratio3": (last3 / prior12) if prior12 else None,
                    "share": (v / totals[-1]) if totals[-1] else None, "flags": flags})
    out.sort(key=lambda r: -r["latest"])
    return out
