"""Carbon cost exposure indicator (spec §9.5) — v1.1, per-zone regional factors.

Net indirect carbon cost per tonne Cl2:
    EUA_monthly × zone_emission_factor × electricity_intensity × (1 − aid_intensity)

Computed per chlor-alkali member state using its Annex III regional CO2 factor
(Communication 2021/C 528/01 point (5)), plus one EU27 headline row using the
configured headline zone (CWE — feeds the cost-gap waterfall). All constants
come from the benchmark_constant table (seeded from config/carbon.yaml WITH
citations) — never a remembered number.
"""
import json
import logging

from observatory.settings import load_config

log = logging.getLogger(__name__)


def compute(conn, run_id: int) -> int:
    cfg = load_config("carbon")["indicator"]
    consts = {r["key"]: r for r in conn.execute(
        "SELECT * FROM benchmark_constant").fetchall()}
    for key in ("ets_cl_electricity_intensity", "ets_aid_intensity", cfg["headline_zone"]):
        if key not in consts:
            log.warning("carbon: benchmark constant %s missing, skipping", key)
            return 0
    intensity = float(consts["ets_cl_electricity_intensity"]["value"])
    aid = float(consts["ets_aid_intensity"]["value"])

    eua = conn.execute(
        """SELECT period, period_start, value, source, source_dataset, retrieved_at
           FROM v_series_latest WHERE series_id = 'carbon.eua_price'"""
    ).fetchall()

    # (geo, zone-constant) pairs: headline EU row + per-country rows
    targets = [("EU27_2020", cfg["headline_zone"])]
    targets += [(geo, zone) for geo, zone in cfg["country_zones"].items()
                if zone in consts]

    n = 0
    for geo, zone_key in targets:
        zone = consts[zone_key]
        ef = float(zone["value"])
        for r in eua:
            gross = float(r["value"]) * ef * intensity
            net = gross * (1 - aid)
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, period, period_start,
                    value, unit, inputs, run_id)
                   VALUES ('carbon_cost_exposure',%s,%s,%s,%s,%s,'EUR/t Cl2',%s,%s)""",
                (cfg["methodology_version"], geo, r["period"], r["period_start"],
                 round(net, 2),
                 json.dumps({
                     "eua_eur_tco2": float(r["value"]),
                     "eua_source": {"source": r["source"],
                                    "source_dataset": r["source_dataset"],
                                    "retrieved_at": str(r["retrieved_at"])},
                     "zone": {"key": zone_key, "factor_tco2_mwh": ef,
                              "citation": zone["citation"],
                              "confirmed": zone["confirmed"]},
                     "intensity_mwh_t": intensity,
                     "aid_intensity": aid,
                     "gross_eur_t_cl2": round(gross, 2),
                     "headline": geo == "EU27_2020",
                     "note": "net of maximum compensation; member states without compensation face the gross figure",
                 }), run_id))
            n += 1
    return n
