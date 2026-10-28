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
        cl2_value = edc_uv[sem]   # mass allocation: a tonne of Cl2 carries the EDC price per tonne
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
                 "chlorine_value_basis": p["chlorine_value_basis"],
                 "excludes": "carbon cost, non-power variable costs, ethylene in EDC",
             }), run_id))
        n += 1
    return n


SEMESTERS = ("S1", "S2")
MONTHS = tuple(f"{m:02d}" for m in range(1, 13))


def annual_means(series: dict, parts: tuple) -> dict:
    """{period 'YYYY-<part>': value} -> {'YYYY': mean}, only for complete years."""
    by_year = defaultdict(dict)
    for period, v in series.items():
        year, _, part = period.partition("-")
        by_year[year][part] = v
    return {y: sum(v[p] for p in parts) / len(parts)
            for y, v in by_year.items() if all(p in v for p in parts)}


def ecu_cash_cost_rows(power: dict, argus: dict, params: dict) -> list[dict]:
    """Pure core of the ECU cash-cost indicators, for tests.

    power: {country: {year 'YYYY': annual EUR/MWh}}
    argus: {year 'YYYY': {component: EUR/t ECU}}
    Returns one dict per year where every country has a price and Argus has
    salt/other/fixed. Countries are averaged unweighted (Argus' EU4 basis).
    """
    out = []
    for year, comp in sorted(argus.items()):
        if not all(k in comp for k in ("salt", "other", "fixed")):
            continue
        annual = {c: power.get(c, {}).get(year) for c in params["countries"]}
        if None in annual.values():
            continue
        price = sum(annual.values()) / len(annual)
        power_cost = params["mwh_per_ecu"] * price
        total = power_cost + comp["salt"] + comp["other"] + comp["fixed"]
        out.append({"year": year, "power_price_eur_mwh": round(price, 2),
                    "country_prices": {c: round(v, 2) for c, v in annual.items()},
                    "power": round(power_cost, 1), "salt": comp["salt"],
                    "other": comp["other"], "fixed": comp["fixed"],
                    "total": round(total, 1), "argus_total": comp.get("total"),
                    "argus_power": comp.get("power")})
    return out


def _insert_ecu_cash_cost(conn, run_id, indicator_id, spec, rows, power_source, geo="EU4") -> int:
    for row in rows:
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, period, period_start,
                value, unit, inputs, run_id)
               VALUES (%s,%s,%s,%s,%s,%s,'EUR/t ECU',%s,%s)""",
            (indicator_id, spec["methodology_version"], geo, row["year"], f"{row['year']}-01-01",
             row["total"],
             json.dumps({**row, "licensed": True, "params": spec["params"],
                         "power_source": power_source,
                         "non_power_source": "Argus 2023 Final Report, Fig 5-4 p.97 (licensed)"}),
             run_id))
    return len(rows)


def compute_ecu_cash_cost(conn, run_id: int, cfg: dict) -> int:
    """EU4 ECU cash cost, two electricity bases + Argus non-power costs.
    ecu_cash_cost: Eurostat price paid by large users (X_TAX), half-yearly.
    ecu_cash_cost_wholesale: ENTSO-E day-ahead, Argus' own price assumption.
    Licensed (Argus inputs) — rows carry inputs.licensed so public mode hides them."""
    argus = defaultdict(dict)
    for r in conn.execute(
            """SELECT period, band, value FROM v_series_latest
               WHERE series_id = 'cost.ecu_cash_cost_argus' AND geo_id = 'EU4'""").fetchall():
        argus[r["period"]][r["band"]] = float(r["value"])

    spec = cfg["ecu_cash_cost"]
    p = spec["params"]
    paid = defaultdict(dict)
    for r in conn.execute(
            """SELECT geo_id, period, value FROM v_series_latest
               WHERE series_id = 'power.industrial_delivered' AND band = 'MWH_GE150000'
                 AND tax_treatment = %s AND geo_id = ANY(%s)
                 AND value > 0   -- Eurostat writes 0 where no consumer is that large (EE, LV, LT)""",
            (p["tax_treatment"], p["countries"] + cfg["ecu_cash_cost_country"]["params"]["countries"])).fetchall():
        paid[r["geo_id"]][r["period"]] = float(r["value"])
    paid = {c: annual_means(v, SEMESTERS) for c, v in paid.items()}
    paid_source = "Eurostat nrg_pc_205, MWH_GE150000, " + p["tax_treatment"]
    n = _insert_ecu_cash_cost(conn, run_id, "ecu_cash_cost", spec,
                              ecu_cash_cost_rows(paid, argus, p), paid_source)
    # one country at a time: a country without a year must not drop it for the others
    spec = cfg["ecu_cash_cost_country"]
    for c in spec["params"]["countries"]:
        n += _insert_ecu_cash_cost(conn, run_id, "ecu_cash_cost_country", spec,
                                   ecu_cash_cost_rows(paid, argus, {**p, "countries": [c]}),
                                   paid_source, geo=c)

    spec = cfg["ecu_cash_cost_wholesale"]
    p = spec["params"]
    zone_of = p["zones"]                     # country -> ENTSO-E bidding zone
    zone_country = cfg["ecu_cash_cost_wholesale_country"]["params"]["zones"]
    wholesale = defaultdict(dict)
    for r in conn.execute(
            """SELECT geo_id, period, value FROM v_series_latest
               WHERE series_id = 'power.wholesale_day_ahead' AND geo_id = ANY(%s)""",
            (list({**zone_of, **zone_country}.values()),)).fetchall():
        wholesale[r["geo_id"]][r["period"]] = float(r["value"])
    wholesale_source = "ENTSO-E Transparency Platform, day-ahead prices (monthly means)"
    annual = {c: annual_means(wholesale.get(z, {}), MONTHS) for c, z in zone_of.items()}
    n += _insert_ecu_cash_cost(
        conn, run_id, "ecu_cash_cost_wholesale", spec,
        ecu_cash_cost_rows(annual, argus, {**p, "countries": list(zone_of)}), wholesale_source)

    spec = cfg["ecu_cash_cost_wholesale_country"]
    for c, z in zone_country.items():
        rows = ecu_cash_cost_rows({c: annual_means(wholesale.get(z, {}), MONTHS)}, argus,
                                  {**p, "countries": [c]})
        n += _insert_ecu_cash_cost(conn, run_id, "ecu_cash_cost_wholesale_country", spec,
                                   [{**r, "zone": z} for r in rows], wholesale_source, geo=c)
    return n
