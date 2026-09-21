"""Trade screening — sudden volume rises and unit-value drops in extra-EU imports/
exports by partner.

Pure screening logic in `screen()` / `screen_price()` (unit-tested); `compute()`
writes one indicator row per hit (`trade_surge` for volume, `trade_price_drop` for
price) and upserts recent hits into `alert`, the durable table the notifier reads
(fact_indicator is rebuilt every night, so 'already notified' cannot live there).
"""
import json
import logging
from collections import defaultdict
from statistics import mean

from observatory.settings import load_config

log = logging.getLogger(__name__)

INDICATOR = {"volume": "trade_surge", "price": "trade_price_drop"}
EU_MEMBERS = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL",
              "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
              "ES", "SE"}


def _severity(ratio, share, sev_cfg):
    if (ratio is not None and ratio >= sev_cfg["high_ratio"]) or \
       (share is not None and share >= sev_cfg["high_share"]):
        return "high"
    return "medium"


def screen(values, totals, thresholds, sev_cfg, aggregate=False):
    """Volume screen on one monthly tonnage series.

    values: tonnes per month (chronological, missing months as 0)
    totals: extra-EU tonnes per month, same grid (share denominator)
    Returns hits: {index, test, value, baseline, ratio, share, severity, new_origin}
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


def _wuv(qty, val):
    """Tonnage-weighted unit value over a window, or None if nothing shipped."""
    q = sum(qty)
    return (sum(val) / q) if q else None


def screen_price(qty, val, totals, thresholds, sev_cfg, aggregate=False):
    """Unit-value screen: a drop in the partner's tonnage-weighted EUR/t against its
    own previous 12 months, on a material flow (tonnage + share floors, as for volume).
    Returns hits: {index, test, uv, baseline_uv, drop, quantity, share, severity}.
    A partner with no baseline shipments has no price hit (the volume screen covers it).
    """
    hits = []
    n = len(qty)
    for test, lo, span in (("month", 12, 1), ("quarter", 14, 3)):
        t = thresholds[test]
        for i in range(lo, n):
            win = slice(i - span + 1, i + 1)
            prior = slice(i - span + 1 - 12, i - span + 1)
            q_win = sum(qty[win])
            if q_win / span < t["min_t"] or sum(qty[prior]) < t["min_t"]:
                continue
            share = (q_win / sum(totals[win])) if (not aggregate and sum(totals[win])) else None
            if not aggregate and (share is None or share < t["min_share"]):
                continue
            uv, base = _wuv(qty[win], val[win]), _wuv(qty[prior], val[prior])
            if uv is None or not base:
                continue
            drop = 1 - uv / base
            if drop < t["drop"]:
                continue
            sev = "high" if drop >= sev_cfg["high_drop"] or \
                (share is not None and share >= sev_cfg["high_share"]) else "medium"
            hits.append({"index": i, "test": test, "uv": uv, "baseline_uv": base, "drop": drop,
                         "quantity": q_win / span, "share": share, "severity": sev})
    return hits


def _load_trade(conn):
    """{(product, flow): {partner: {period: (tonnes, eur)}}} for the whole basket."""
    rows = conn.execute(
        """SELECT series_id, product_code, flow, partner_geo_id, period, value
           FROM v_series_latest
           WHERE series_id IN ('trade.quantity', 'trade.value') AND geo_id = 'EU27_2020'
             AND period LIKE '%-%'"""
    ).fetchall()
    data = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    for r in rows:
        slot = 0 if r["series_id"] == "trade.quantity" else 1
        data[(r["product_code"], r["flow"])][r["partner_geo_id"]][r["period"]][slot] = float(r["value"])
    return data


def screen_all(data, cfg):
    """Run both screens over every product/flow/partner. Returns hit dicts with
    kind ('volume' | 'price'), product, flow, partner and period added."""
    excluded = set(cfg["excluded_partners"]) | EU_MEMBERS
    pcfg = cfg["price"]
    out = []
    for (product, flow), partners in data.items():
        total = partners.get("EXTRA_EU")
        if not total:
            continue
        months = sorted(total)
        tot_q = [total.get(p, (0.0, 0.0))[0] for p in months]
        tot_v = [total.get(p, (0.0, 0.0))[1] for p in months]
        tag = lambda h, kind, partner: {**h, "kind": kind, "product": product, "flow": flow,
                                        "partner": partner, "period": months[h["index"]]}
        for h in screen(tot_q, tot_q, cfg["aggregate"], cfg["severity"], aggregate=True):
            out.append(tag(h, "volume", "EXTRA_EU"))
        for h in screen_price(tot_q, tot_v, tot_q, pcfg["aggregate"], pcfg["severity"], aggregate=True):
            out.append(tag(h, "price", "EXTRA_EU"))
        for partner, series in partners.items():
            if partner in excluded:
                continue
            q = [series.get(p, (0.0, 0.0))[0] for p in months]
            v = [series.get(p, (0.0, 0.0))[1] for p in months]
            for h in screen(q, tot_q, cfg["partner"], cfg["severity"]):
                out.append(tag(h, "volume", partner))
            for h in screen_price(q, v, tot_q, pcfg["partner"], pcfg["severity"]):
                out.append(tag(h, "price", partner))
    return out


def _inputs(h, cfg):
    common = {"kind": h["kind"], "flow": h["flow"], "partner": h["partner"], "test": h["test"],
              "share": h["share"] and round(h["share"], 3), "severity": h["severity"],
              "methodology_version": cfg["methodology_version"], "confirmed": cfg["confirmed"],
              "source": "Eurostat Comext (trade.quantity, trade.value)"}
    if h["kind"] == "volume":
        return {**common, "baseline_t": round(h["baseline"], 1),
                "ratio": h["ratio"] and round(h["ratio"], 2), "new_origin": h["new_origin"]}
    return {**common, "baseline_uv": round(h["baseline_uv"], 1), "drop": round(h["drop"], 3),
            "quantity_t": round(h["quantity"], 1)}


def compute(conn, run_id: int) -> int:
    cfg = load_config("surges")
    data = _load_trade(conn)
    hits = screen_all(data, cfg)
    latest = {}
    for (product, flow), partners in data.items():
        months = sorted(partners.get("EXTRA_EU", {}))
        latest[(product, flow)] = set(months[-cfg["alert_window_months"]:])
    n = 0
    for h in hits:
        inputs = _inputs(h, cfg)
        value, unit = (h["value"], "t") if h["kind"] == "volume" else (h["uv"], "EUR/t")
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, comparator_geo_id, product_code,
                period, period_start, value, unit, inputs, run_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (INDICATOR[h["kind"]], cfg["methodology_version"], "EU27_2020", h["partner"],
             h["product"], h["period"], f"{h['period']}-01", round(value, 1), unit,
             json.dumps(inputs), run_id),
        )
        n += 1
        if h["period"] in latest[(h["product"], h["flow"])]:
            conn.execute(
                """INSERT INTO alert (kind, product_code, flow, partner_geo_id, period, test,
                                      severity, value, inputs)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (kind, product_code, flow, partner_geo_id, period, test)
                   DO UPDATE SET severity = EXCLUDED.severity, value = EXCLUDED.value,
                                 inputs = EXCLUDED.inputs, last_seen = now()""",
                (INDICATOR[h["kind"]], h["product"], h["flow"], h["partner"], h["period"],
                 h["test"], h["severity"], round(value, 1), json.dumps(inputs)),
            )
    log.info("trade screening: %d hits (%d price)", n, sum(h["kind"] == "price" for h in hits))
    return n


def partner_stats(series_by_partner, months, cfg=None):
    """Latest-month statistics per partner for the dashboard table (same maths as the
    screens). series_by_partner: {partner: {period: (tonnes, eur)}}."""
    cfg = cfg or load_config("surges")
    total = series_by_partner.get("EXTRA_EU", {})
    totals = [total.get(p, (0.0, 0.0))[0] for p in months]
    out = []
    for partner, series in series_by_partner.items():
        if partner in set(cfg["excluded_partners"]) | EU_MEMBERS:
            continue
        q = [series.get(p, (0.0, 0.0))[0] for p in months]
        v = [series.get(p, (0.0, 0.0))[1] for p in months]
        if len(q) < 15:
            continue
        latest, prior = q[-1], q[-13:-1]
        base = mean(prior)
        last3, prior12 = mean(q[-3:]), mean(q[-15:-3])
        uv, uv12 = _wuv(q[-1:], v[-1:]), _wuv(q[-13:-1], v[-13:-1])
        recent = len(q) - 3
        flags = sorted({h["test"] for h in screen(q, totals, cfg["partner"], cfg["severity"])
                        if h["index"] >= recent})
        if any(h["index"] >= recent for h in
               screen_price(q, v, totals, cfg["price"]["partner"], cfg["price"]["severity"])):
            flags.append("price")
        out.append({"geo": partner, "latest": latest, "mean12": base, "max12": max(prior),
                    "ratio": (latest / base) if base else None, "avg3": last3,
                    "ratio3": (last3 / prior12) if prior12 else None,
                    "share": (latest / totals[-1]) if totals[-1] else None,
                    "uv": uv, "uv12": uv12,
                    "uv_change": (uv / uv12 - 1) if (uv is not None and uv12) else None,
                    "flags": flags})
    out.sort(key=lambda r: -r["latest"])
    return out
