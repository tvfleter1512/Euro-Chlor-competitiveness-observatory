"""Utilisation gap (spec §9.3): EU operating rate minus comparator.

Monthly vs US (Chlorine Institute series), annual vs China (CCAIA annual
figure vs the EU annual survey TOTAL). Inputs are member-restricted, so every
indicator row carries licensed:true in inputs — the API hides these in
public mode.
"""
import json
import logging

log = logging.getLogger(__name__)


def _series(conn, geo, monthly):
    op = "LIKE" if monthly else "NOT LIKE"
    return conn.execute(
        f"""SELECT period, period_start, value, source, source_dataset
            FROM v_series_latest
            WHERE series_id = 'production.utilisation' AND geo_id = %s
              AND band IS NULL AND period {op} '%%-%%'""",
        (geo,),
    ).fetchall()


def compute(conn, run_id: int, cfg: dict) -> int:
    spec = cfg["utilisation_gap"]
    n = 0
    for comparator, monthly in (("US", True), ("CN", False)):
        eu = {r["period"]: r for r in _series(conn, "EU27_EFTA_UK", monthly)}
        comp = _series(conn, comparator, monthly)
        for c in comp:
            e = eu.get(c["period"])
            if e is None:
                continue
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, comparator_geo_id,
                    period, period_start, value, unit, inputs, run_id)
                   VALUES ('utilisation_gap',%s,'EU27_EFTA_UK',%s,%s,%s,%s,'pp',%s,%s)""",
                (spec["methodology_version"], comparator, c["period"],
                 c["period_start"], round(float(e["value"]) - float(c["value"]), 2),
                 json.dumps({
                     "licensed": True,
                     "eu_pct": float(e["value"]), "comparator_pct": float(c["value"]),
                     "eu_source": {"source": e["source"], "source_dataset": e["source_dataset"]},
                     "comparator_source": {"source": c["source"], "source_dataset": c["source_dataset"]},
                     "periodicity": "monthly" if monthly else "annual",
                 }), run_id))
            n += 1
    return n
