"""Core Dependency Indicators (CDI) — EU Commission screening methodology.

Computes, per basket product (CN8):
  cdi1_hhi          — Herfindahl–Hirschman index over extra-EU supplier countries
  cdi2_reliance     — extra-EU import value / total (extra + intra) import value
  cdi3_substitution — extra-EU import value / (intra + extra) EU export value
  cdi_class         — criteria met (0–3) against config thresholds

Annual values for every complete year, plus a rolling window (config
window_months) as the headline period 'L12M'. Thresholds and exclusion lists
live in config/dependency.yaml with citation — nothing is hard-coded here.
"""
import json
import logging
from collections import defaultdict
from datetime import date

from observatory.settings import load_config

log = logging.getLogger(__name__)


def _monthly_imports_by_partner(conn, product):
    rows = conn.execute(
        """SELECT partner_geo_id, period, value FROM v_series_latest
           WHERE series_id = 'trade.value' AND geo_id = 'EU27_2020'
             AND product_code = %s AND flow = 'import'""",
        (product,),
    ).fetchall()
    return rows


def _monthly_exports(conn, product):
    rows = conn.execute(
        """SELECT partner_geo_id, period, value FROM v_series_latest
           WHERE series_id = 'trade.value' AND geo_id = 'EU27_2020'
             AND product_code = %s AND flow = 'export'""",
        (product,),
    ).fetchall()
    return rows


def _windows(all_months, window_months):
    """(label, period_start, set-of-months) for complete years + rolling window."""
    months = sorted(all_months)
    wins = []
    by_year = defaultdict(list)
    for m in months:
        by_year[m[:4]].append(m)
    for year, ms in sorted(by_year.items()):
        if len(ms) == 12:
            wins.append((year, date(int(year), 1, 1), set(ms)))
    tail = months[-window_months:]
    if len(tail) == window_months:
        wins.append(("L12M", date(int(tail[0][:4]), int(tail[0][5:7]), 1), set(tail)))
    return wins


def compute(conn, run_id: int) -> int:
    cfg = load_config("dependency")
    version = cfg["methodology_version"]
    thresholds = {k: v["threshold"] for k, v in cfg["indicators"].items()}
    non_suppliers = set(cfg["eu_member_partners"]) | set(cfg["excluded_partners"]) \
        | {"EXTRA_EU", "INTRA_EU"}
    basket = load_config("product_basket")["products"]
    n = 0

    for prod in basket:
        for cn8 in prod["cn8"]:
            imports = _monthly_imports_by_partner(conn, cn8)
            exports = _monthly_exports(conn, cn8)
            if not imports:
                continue
            months = {r["period"] for r in imports}
            for label, pstart, win in _windows(months, cfg["window_months"]):
                extra_imp = sum(float(r["value"]) for r in imports
                                if r["period"] in win and r["partner_geo_id"] == "EXTRA_EU")
                intra_imp = sum(float(r["value"]) for r in imports
                                if r["period"] in win and r["partner_geo_id"] == "INTRA_EU")
                by_supplier = defaultdict(float)
                for r in imports:
                    if r["period"] in win and r["partner_geo_id"] not in non_suppliers:
                        by_supplier[r["partner_geo_id"]] += float(r["value"])
                supplier_total = sum(by_supplier.values())
                exp_total = sum(float(r["value"]) for r in exports
                                if r["period"] in win
                                and r["partner_geo_id"] in ("INTRA_EU", "EXTRA_EU"))
                by_destination = defaultdict(float)
                for r in exports:
                    if r["period"] in win and r["partner_geo_id"] not in non_suppliers:
                        by_destination[r["partner_geo_id"]] += float(r["value"])
                destination_total = sum(by_destination.values())

                values = {}
                if supplier_total > 0:
                    values["cdi1_hhi"] = sum((v / supplier_total) ** 2
                                             for v in by_supplier.values())
                if extra_imp + intra_imp > 0:
                    values["cdi2_reliance"] = extra_imp / (extra_imp + intra_imp)
                if exp_total > 0:
                    values["cdi3_substitution"] = extra_imp / exp_total

                top = sorted(by_supplier.items(), key=lambda kv: -kv[1])[:10]
                top_dest = sorted(by_destination.items(), key=lambda kv: -kv[1])[:10]
                inputs = {
                    "citation": cfg["citation"],
                    "window": label,
                    "extra_eu_imports_eur": extra_imp,
                    "intra_eu_imports_eur": intra_imp,
                    "eu_exports_eur": exp_total,
                    "n_suppliers": len(by_supplier),
                    "top_suppliers": [
                        {"geo": g, "value_eur": v,
                         "share": v / supplier_total if supplier_total else None}
                        for g, v in top],
                    "supplier_total_eur": supplier_total,
                    "top_destinations": [
                        {"geo": g, "value_eur": v,
                         "share": v / destination_total if destination_total else None}
                        for g, v in top_dest],
                    "source": "Eurostat Comext DS-045409 (partner detail)",
                }

                for ind, value in values.items():
                    conn.execute(
                        """INSERT INTO fact_indicator
                           (indicator_id, methodology_version, geo_id, product_code,
                            period, period_start, value, unit, inputs, run_id)
                           VALUES (%s,%s,'EU27_2020',%s,%s,%s,%s,'ratio',%s,%s)""",
                        (ind, version, cn8, label, pstart, round(value, 4),
                         json.dumps(inputs), run_id))
                    n += 1

                if len(values) == 3:
                    met = sum(1 for ind, v in values.items() if v > thresholds[ind])
                    conn.execute(
                        """INSERT INTO fact_indicator
                           (indicator_id, methodology_version, geo_id, product_code,
                            period, period_start, value, unit, inputs, run_id)
                           VALUES ('cdi_class',%s,'EU27_2020',%s,%s,%s,%s,'criteria',%s,%s)""",
                        (version, cn8, label, pstart, met,
                         json.dumps({**inputs, "class": cfg["classes"][met],
                                     "thresholds": thresholds,
                                     "cdi_values": values}), run_id))
                    n += 1
    return n
