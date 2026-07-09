"""Import penetration — caustic soda, dry basis (assessment §2.11).

extra-EU imports ÷ apparent consumption (PRODCOM sold production + imports −
exports), annual. All basis assumptions come from config and are recorded in
inputs; rows carry the 'estimated' caveat via inputs (PRODCOM excludes captive
use; lye basis pending confirmation).
"""
import json
import logging
from collections import defaultdict

from observatory.settings import load_config

log = logging.getLogger(__name__)

SOLID_CN8, LYE_CN8 = "28151100", "28151200"
PRODCOM_CODES = ("20132525", "20132527")   # solid + lye sold production


def _annual_trade_dry(conn, lye_dry: float) -> dict:
    rows = conn.execute(
        """SELECT product_code, flow, period, value FROM v_series_latest
           WHERE series_id = 'trade.quantity' AND geo_id = 'EU27_2020'
             AND partner_geo_id = 'EXTRA_EU' AND product_code IN (%s, %s)""",
        (SOLID_CN8, LYE_CN8),
    ).fetchall()
    agg = defaultdict(lambda: {"import": 0.0, "export": 0.0, "months": set()})
    for r in rows:
        year = r["period"][:4]
        factor = lye_dry if r["product_code"] == LYE_CN8 else 1.0
        agg[year][r["flow"]] += float(r["value"]) * factor
        agg[year]["months"].add(r["period"])
    return agg


def compute(conn, run_id: int, cfg: dict) -> int:
    spec = cfg["import_penetration"]
    lye_dry = spec["params"]["lye_dry_content"]
    prod = conn.execute(
        """SELECT period, period_start, value, product_code FROM v_series_latest
           WHERE series_id = 'production.sold_production'
             AND product_code IN (%s, %s)""", PRODCOM_CODES,
    ).fetchall()
    prod_by_year = defaultdict(float)
    starts = {}
    for r in prod:
        prod_by_year[r["period"]] += float(r["value"])
        starts[r["period"]] = r["period_start"]
    trade = _annual_trade_dry(conn, lye_dry)
    n = 0
    for year, sold in sorted(prod_by_year.items()):
        t = trade.get(year)
        if not t or len(t["months"]) < 12:   # only complete trade years
            continue
        apparent = sold + t["import"] - t["export"]
        if apparent <= 0:
            continue
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, period, period_start,
                value, unit, inputs, run_id)
               VALUES ('import_penetration',%s,'EU27_2020',%s,%s,%s,'share',%s,%s)""",
            (spec["methodology_version"], year, starts[year],
             round(t["import"] / apparent, 4),
             json.dumps({
                 "params": spec["params"],
                 "params_confirmed": spec.get("params_confirmed", False),
                 "sold_production_t": round(sold),
                 "extra_eu_imports_dry_t": round(t["import"]),
                 "extra_eu_exports_dry_t": round(t["export"]),
                 "apparent_consumption_t": round(apparent),
                 "quality": "estimated — PRODCOM excludes captive use; lye basis unconfirmed",
                 "sources": "Eurostat PRODCOM DS-059358 + Comext DS-045409",
             }), run_id))
        n += 1
    return n
