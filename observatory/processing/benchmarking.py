"""Benchmarking agent (spec §5.2/§9) — computes indicators declared in
config/indicators.yaml, stamping methodology_version and full input provenance.

Phase 1 indicators: electricity_cost_ratio, trade_balance, trade_balance_quantity.
Comparator rows flagged 'estimated' propagate that flag into the indicator inputs.
"""
import json
import logging
from collections import defaultdict

from observatory import db
from observatory.processing import carbon, dependency, margins, penetration
from observatory.processing import normalisation as norm
from observatory.settings import load_config

log = logging.getLogger(__name__)

# Consumption band used for the EU delivered price in ratio computations:
# chlor-alkali plants sit in the largest Eurostat band. Human-confirmable choice.
EU_BAND = "MWH_GE150000"
EU_TAX = "X_VAT"   # excl. VAT (recoverable) but incl. non-recoverable levies


def _eu_delivered(conn) -> dict[str, dict]:
    rows = conn.execute(
        """SELECT * FROM v_series_latest
           WHERE series_id = 'power.industrial_delivered' AND geo_id = 'EU27_2020'
             AND band = %s AND tax_treatment = %s""",
        (EU_BAND, EU_TAX),
    ).fetchall()
    return {r["period"]: r for r in rows}


def _comparator_delivered_by_semester(conn, geo: str, fx: dict) -> dict[str, dict]:
    """Comparator monthly/annual delivered prices -> EUR/MWh semester averages."""
    rows = conn.execute(
        """SELECT * FROM v_series_latest
           WHERE series_id = 'power.industrial_delivered' AND geo_id = %s""",
        (geo,),
    ).fetchall()
    buckets = defaultdict(list)
    for r in rows:
        try:
            eur, _ = norm.to_eur(float(r["value"]), r["currency"], r["period_start"], fx)
        except norm.FXError as exc:
            log.warning("skipping %s %s: %s", geo, r["period"], exc)
            continue
        if r["period"].isdigit():   # annual proxy row: applies to both semesters
            for sem in ("S1", "S2"):
                buckets[f"{r['period']}-{sem}"].append((eur, r))
        else:
            sem, _ = norm.semester_of(r["period_start"])
            buckets[sem].append((eur, r))
    out = {}
    for sem, vals in buckets.items():
        prices = [v for v, _ in vals]
        sample = vals[0][1]
        out[sem] = {
            "value": sum(prices) / len(prices),
            "n_months": len(prices),
            "quality_flag": max((r["quality_flag"] for _, r in vals),
                                key=lambda q: q == "estimated"),
            "source": sample["source"],
            "source_dataset": sample["source_dataset"],
            "retrieved_at": str(sample["retrieved_at"]),
        }
    return out


def _provenance_of(row) -> dict:
    return {"source": row["source"], "source_dataset": row["source_dataset"],
            "reference_period": row["reference_period"],
            "retrieved_at": str(row["retrieved_at"]),
            "quality_flag": row["quality_flag"], "run_id": row["run_id"]}


def compute_electricity_cost_ratio(conn, run_id: int, cfg: dict) -> int:
    fx = norm.load_fx(conn)
    eu = _eu_delivered(conn)
    regions = load_config("regions")["comparators"]
    version = cfg["electricity_cost_ratio"]["methodology_version"]
    n = 0
    for comp in regions:
        comp_sem = _comparator_delivered_by_semester(conn, comp["geo_id"], fx)
        for period, eu_row in eu.items():
            c = comp_sem.get(period)
            if not c:
                continue
            ratio = float(eu_row["value"]) / c["value"]
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, comparator_geo_id,
                    period, period_start, value, unit, inputs, run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                ("electricity_cost_ratio", version, "EU27_2020", comp["geo_id"],
                 period, eu_row["period_start"], round(ratio, 4), "ratio",
                 json.dumps({"eu": _provenance_of(eu_row),
                             "eu_band": EU_BAND, "eu_tax": EU_TAX,
                             "comparator": c}),
                 run_id),
            )
            n += 1
    return n


def compute_trade_balance(conn, run_id: int, cfg: dict) -> int:
    n = 0
    for indicator, series, unit in (("trade_balance", "trade.value", "EUR"),
                                    ("trade_balance_quantity", "trade.quantity", "t")):
        version = cfg[indicator]["methodology_version"]
        rows = conn.execute(
            """SELECT product_code, period, period_start, flow, value, source,
                      source_dataset, reference_period, retrieved_at, quality_flag, run_id
               FROM v_series_latest
               WHERE series_id = %s AND geo_id = 'EU27_2020' AND partner_geo_id = 'EXTRA_EU'""",
            (series,),
        ).fetchall()
        grouped = defaultdict(dict)
        for r in rows:
            grouped[(r["product_code"], r["period"])][r["flow"]] = r
        for (product, period), flows in grouped.items():
            if "import" not in flows or "export" not in flows:
                continue
            exp, imp = flows["export"], flows["import"]
            conn.execute(
                """INSERT INTO fact_indicator
                   (indicator_id, methodology_version, geo_id, product_code,
                    period, period_start, value, unit, inputs, run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (indicator, version, "EU27_2020", product, period,
                 exp["period_start"], float(exp["value"]) - float(imp["value"]), unit,
                 json.dumps({"export": _provenance_of(exp), "import": _provenance_of(imp),
                             "partner": "EXTRA_EU"}),
                 run_id),
            )
            n += 1
    return n


def run() -> dict:
    cfg = load_config("indicators")["indicators"]
    with db.get_conn() as conn:
        run_id = db.start_run(conn, "benchmarking")
        try:
            # recompute from scratch each run; history lives in fact_series vintages
            conn.execute("DELETE FROM fact_indicator")
            n = compute_electricity_cost_ratio(conn, run_id, cfg)
            n += compute_trade_balance(conn, run_id, cfg)
            n += dependency.compute(conn, run_id)
            n += margins.compute_gas_spread(conn, run_id, cfg)
            n += margins.compute_ecu_margin(conn, run_id, cfg)
            n += carbon.compute(conn, run_id)
            n += penetration.compute(conn, run_id, cfg)
            conn.commit()
            db.finish_run(conn, run_id, "success", n)
            return {"agent": "benchmarking", "status": "success", "indicators": n}
        except Exception as exc:
            conn.rollback()
            db.finish_run(conn, run_id, "failed", notes=str(exc))
            log.exception("benchmarking failed")
            return {"agent": "benchmarking", "status": "failed", "error": str(exc)}
