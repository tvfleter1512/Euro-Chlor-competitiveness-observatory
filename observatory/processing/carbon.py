"""Carbon cost exposure indicator (spec §9.5, assessment §2.8).

Net indirect carbon cost per tonne Cl2:
    EUA_monthly × emission_factor × electricity_intensity × (1 − aid_intensity)

All three constants come from the benchmark_constant table (seeded from
config/carbon.yaml WITH citations to the source Communications). If any is
missing the indicator is skipped — never a remembered number.
"""
import json
import logging

from observatory.settings import load_config

log = logging.getLogger(__name__)

REQUIRED = ("ets_cl_electricity_intensity", "ets_emission_factor", "ets_aid_intensity")


def compute(conn, run_id: int) -> int:
    consts = {r["key"]: r for r in conn.execute(
        "SELECT * FROM benchmark_constant WHERE key = ANY(%s)", (list(REQUIRED),)
    ).fetchall()}
    if set(consts) != set(REQUIRED):
        log.warning("carbon: benchmark constants missing, skipping (%s)", set(REQUIRED) - set(consts))
        return 0
    version = load_config("carbon")["indicator"]["methodology_version"]
    intensity = float(consts["ets_cl_electricity_intensity"]["value"])
    ef = float(consts["ets_emission_factor"]["value"])
    aid = float(consts["ets_aid_intensity"]["value"])
    confirmed = all(consts[k]["confirmed"] for k in REQUIRED)

    eua = conn.execute(
        """SELECT period, period_start, value, source, source_dataset, retrieved_at
           FROM v_series_latest WHERE series_id = 'carbon.eua_price'"""
    ).fetchall()
    n = 0
    for r in eua:
        gross = float(r["value"]) * ef * intensity
        net = gross * (1 - aid)
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, period, period_start,
                value, unit, inputs, run_id)
               VALUES ('carbon_cost_exposure',%s,'EU27_2020',%s,%s,%s,'EUR/t Cl2',%s,%s)""",
            (version, r["period"], r["period_start"], round(net, 2),
             json.dumps({
                 "eua_eur_tco2": float(r["value"]),
                 "eua_source": {"source": r["source"], "source_dataset": r["source_dataset"],
                                "retrieved_at": str(r["retrieved_at"])},
                 "gross_eur_t_cl2": round(gross, 2),
                 "constants": {k: {"value": float(consts[k]["value"]),
                                   "citation": consts[k]["citation"],
                                   "confirmed": consts[k]["confirmed"]} for k in REQUIRED},
                 "constants_confirmed": confirmed,
                 "note": "net of maximum indirect-cost compensation; member states without compensation face the gross figure",
             }), run_id))
        n += 1
    return n
