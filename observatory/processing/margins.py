"""Gas-spread and ECU cash-margin proxy indicators (assessment §2.2/§2.3).

Every parameter comes from config/indicators.yaml (params flagged for
confirmation); nothing numeric is inlined here.
"""
import json
import logging
from collections import defaultdict

from observatory.processing import normalisation as norm

log = logging.getLogger(__name__)


def compute_gas_spread(conn, run_id: int, cfg: dict) -> int:
    rows = conn.execute(
        """SELECT geo_id, period, period_start, value, source, source_dataset,
                  reference_period, retrieved_at, quality_flag, run_id
           FROM v_series_latest
           WHERE series_id = 'gas.hub_price' AND geo_id IN ('EU27_2020', 'US')"""
    ).fetchall()
    by_period = defaultdict(dict)
    for r in rows:
        by_period[r["period"]][r["geo_id"]] = r
    n = 0
    for period, geos in sorted(by_period.items()):
        if "EU27_2020" not in geos or "US" not in geos:
            continue
        eu, us = geos["EU27_2020"], geos["US"]
        inputs = json.dumps({
            "eu": {"source": eu["source"], "source_dataset": eu["source_dataset"],
                   "retrieved_at": str(eu["retrieved_at"]), "value": float(eu["value"])},
            "us": {"source": us["source"], "source_dataset": us["source_dataset"],
                   "retrieved_at": str(us["retrieved_at"]), "value": float(us["value"])},
        })
        for ind, value, unit in (
                ("gas_hub_spread", float(eu["value"]) - float(us["value"]), "USD/MMBtu"),
                ("gas_hub_ratio",
                 float(eu["value"]) / float(us["value"]) if float(us["value"]) else None,
                 "ratio")):
            if value is None:
                continue
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, comparator_geo_id,
                    period, period_start, value, unit, inputs, run_id)
                   VALUES (%s,%s,'EU27_2020','US',%s,%s,%s,%s,%s,%s)""",
                (ind, cfg[ind]["methodology_version"], period,
                 eu["period_start"], round(value, 4), unit, inputs, run_id))
            n += 1
    return n


def _semester_unit_value(conn, product: str) -> dict:
    """Extra-EU export unit value (EUR/t) per semester for one CN8 product."""
    rows = conn.execute(
        """SELECT series_id, period_start, value FROM v_series_latest
           WHERE geo_id = 'EU27_2020' AND partner_geo_id = 'EXTRA_EU'
             AND product_code = %s AND flow = 'export'
             AND series_id IN ('trade.value', 'trade.quantity')""",
        (product,),
    ).fetchall()
    agg = defaultdict(lambda: {"value": 0.0, "qty": 0.0})
    for r in rows:
        sem, _ = norm.semester_of(r["period_start"])
        key = "value" if r["series_id"] == "trade.value" else "qty"
        agg[sem][key] += float(r["value"])
    return {sem: v["value"] / v["qty"] for sem, v in agg.items() if v["qty"] > 0}


def compute_cost_gap(conn, run_id: int, cfg: dict) -> int:
    """Cost-gap band, v2.0 (owner review 2026-07-09): EU vs comparator, EUR/ECU.

    UNCOMPENSATED = measured power gap × intensity — the EU delivered price
    already embeds the CO2 pass-through, so nothing is added on top (v1.0
    double-counted this). MAX-COMPENSATED subtracts the theoretical maximum
    indirect-cost compensation (EUA × zone EF × benchmark 1.846 × aid).
    Reality sits inside the band; uncompensated member states at the top edge.
    """
    from observatory.settings import load_config
    spec = cfg["cost_gap"]
    p = spec["params"]
    eu_power = {r["period"]: r for r in conn.execute(
        """SELECT period, period_start, value, source, source_dataset, retrieved_at,
                  quality_flag, run_id, reference_period
           FROM v_series_latest
           WHERE series_id = 'power.industrial_delivered' AND geo_id = 'EU27_2020'
             AND band = 'MWH_GE150000' AND tax_treatment = 'X_VAT'""").fetchall()}

    # max compensation from benchmark constants (regulatory formula, cited)
    carbon_cfg = load_config("carbon")["indicator"]
    consts = {r["key"]: r for r in conn.execute(
        "SELECT * FROM benchmark_constant").fetchall()}
    comp_keys = ("ets_cl_electricity_intensity", "ets_aid_intensity",
                 carbon_cfg["headline_zone"])
    have_carbon = all(k in consts for k in comp_keys)
    eua_sem = defaultdict(list)
    if have_carbon:
        for r in conn.execute("""SELECT period_start, value FROM v_series_latest
                                 WHERE series_id = 'carbon.eua_price'""").fetchall():
            sem, _ = norm.semester_of(r["period_start"])
            eua_sem[sem].append(float(r["value"]))

    fx = norm.load_fx(conn)
    n = 0
    for comp in load_config("regions")["comparators"]:
        comp_sem = _comparator_delivered_by_semester_pub(conn, comp["geo_id"], fx)
        for period, eu_row in eu_power.items():
            c = comp_sem.get(period)
            if not c:
                continue
            power_gap = (float(eu_row["value"]) - c["value"]) * p["mwh_per_ecu"]
            max_comp = None
            if have_carbon and eua_sem.get(period):
                eua = sum(eua_sem[period]) / len(eua_sem[period])
                max_comp = (eua
                            * float(consts[carbon_cfg["headline_zone"]]["value"])
                            * float(consts["ets_cl_electricity_intensity"]["value"])
                            * float(consts["ets_aid_intensity"]["value"]))
            gap_compensated = power_gap - max_comp if max_comp is not None else None
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, comparator_geo_id,
                    period, period_start, value, unit, inputs, run_id)
                   VALUES ('cost_gap',%s,'EU27_2020',%s,%s,%s,%s,'EUR/ECU',%s,%s)""",
                (spec["methodology_version"], comp["geo_id"], period,
                 eu_row["period_start"], round(power_gap, 2),   # value = uncompensated edge
                 json.dumps({
                     "components": {
                         "gap_uncompensated_eur_ecu": round(power_gap, 2),
                         "max_compensation_eur_ecu": round(max_comp, 2) if max_comp is not None else None,
                         "gap_max_compensated_eur_ecu": round(gap_compensated, 2) if gap_compensated is not None else None,
                     },
                     "params": p,
                     "params_confirmed": spec.get("params_confirmed", False),
                     "eu_power_eur_mwh": float(eu_row["value"]),
                     "comparator_power_eur_mwh": round(c["value"], 2),
                     "comparator_power_quality": c["quality_flag"],
                     "compensation_constants": {k: float(consts[k]["value"])
                                                for k in comp_keys} if have_carbon else None,
                     "eu_power_source": {"source": eu_row["source"],
                                         "source_dataset": eu_row["source_dataset"]},
                     "comparator_power_source": {"source": c["source"],
                                                 "source_dataset": c["source_dataset"]},
                     "note": ("carbon pass-through is embedded in the measured power gap; "
                              "compensation is the scenario delta (regulatory maximum — "
                              "national caps/degressivity put reality inside the band)"),
                 }), run_id))
            n += 1
    return n


def _comparator_delivered_by_semester_pub(conn, geo, fx):
    """Shared semester alignment (same logic as benchmarking's ratio input)."""
    from observatory.processing.benchmarking import _comparator_delivered_by_semester
    return _comparator_delivered_by_semester(conn, geo, fx)


def compute_ecu_margin(conn, run_id: int, cfg: dict) -> int:
    spec = cfg["ecu_margin_proxy"]
    p = spec["params"]
    power = conn.execute(
        """SELECT period, period_start, value, source, source_dataset, retrieved_at
           FROM v_series_latest
           WHERE series_id = 'power.industrial_delivered' AND geo_id = 'EU27_2020'
             AND band = 'MWH_GE150000' AND tax_treatment = 'X_VAT'"""
    ).fetchall()
    caustic_uv = _semester_unit_value(conn, "28151200")   # lye, EUR/t wet
    edc_uv = _semester_unit_value(conn, "29031500")       # EUR/t EDC
    n = 0
    for pw in power:
        sem = pw["period"]
        if sem not in caustic_uv or sem not in edc_uv:
            continue
        caustic_dry = caustic_uv[sem] * p["caustic_dry_factor"]
        cl2_value = edc_uv[sem] * p["cl_mass_fraction_edc"]
        revenue = p["naoh_dry_per_ecu"] * caustic_dry + cl2_value
        power_cost = p["mwh_per_ecu"] * float(pw["value"])
        margin = revenue - power_cost
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, period, period_start,
                value, unit, inputs, run_id)
               VALUES ('ecu_margin_proxy',%s,'EU27_2020',%s,%s,%s,'EUR/ECU',%s,%s)""",
            (spec["methodology_version"], sem, pw["period_start"], round(margin, 2),
             json.dumps({
                 "params": p, "params_confirmed": spec.get("params_confirmed", False),
                 "caustic_lye_unit_value_eur_t": round(caustic_uv[sem], 2),
                 "caustic_dry_price_eur_t": round(caustic_dry, 2),
                 "edc_unit_value_eur_t": round(edc_uv[sem], 2),
                 "chlorine_value_proxy_eur_t": round(cl2_value, 2),
                 "power_price_eur_mwh": float(pw["value"]),
                 "power_source": {"source": pw["source"],
                                  "source_dataset": pw["source_dataset"],
                                  "retrieved_at": str(pw["retrieved_at"])},
                 "trade_source": "Eurostat Comext DS-045409 extra-EU export unit values",
                 "excludes": "carbon cost (Phase 2), non-power variable costs",
             }), run_id))
        n += 1
    return n
