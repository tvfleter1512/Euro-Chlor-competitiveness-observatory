"""Provenance & validation gatekeeper (spec §8).

The single write path into fact_series. A row missing any mandatory provenance
field goes to the quarantine table with a reason — never silently written,
never silently dropped. All ingestion agents MUST insert through here.
"""
import json
from dataclasses import dataclass, asdict, field
from datetime import datetime, date
from decimal import Decimal, InvalidOperation

MANDATORY_PROVENANCE = ("source", "source_dataset", "reference_period", "retrieved_at")


@dataclass
class SeriesRow:
    series_id: str
    geo_id: str
    period: str
    period_start: date
    value: float | Decimal
    unit: str
    source: str
    source_dataset: str
    reference_period: str
    retrieved_at: datetime
    partner_geo_id: str | None = None
    product_code: str | None = None
    flow: str | None = None
    currency: str | None = None
    fx_vintage: date | None = None
    price_basis: str | None = None
    band: str | None = None
    tax_treatment: str | None = None
    redistribution_class: str = "public"
    quality_flag: str = "ok"


def _validate(row: SeriesRow) -> str | None:
    """Return a rejection reason, or None if the row passes."""
    for f in MANDATORY_PROVENANCE:
        if not getattr(row, f):
            return f"missing mandatory provenance field: {f}"
    if not row.series_id or not row.geo_id or not row.period or not row.unit:
        return "missing series_id/geo_id/period/unit"
    if row.value is None:
        return "value is None"
    try:
        Decimal(str(row.value))
    except (InvalidOperation, ValueError):
        return f"value not numeric: {row.value!r}"
    if row.flow and row.flow not in ("import", "export"):
        return f"invalid flow: {row.flow}"
    if row.quality_flag not in ("ok", "estimated", "suppressed", "outlier"):
        return f"invalid quality_flag: {row.quality_flag}"
    if row.redistribution_class not in ("public", "licensed"):
        return f"invalid redistribution_class: {row.redistribution_class}"
    return None


def insert_rows(conn, run_id: int, agent: str, rows: list[SeriesRow]) -> tuple[int, int]:
    """Validate and insert; returns (inserted, quarantined)."""
    inserted = quarantined = 0
    for row in rows:
        reason = _validate(row)
        if reason:
            conn.execute(
                "INSERT INTO quarantine (run_id, agent, row, reason) VALUES (%s, %s, %s, %s)",
                (run_id, agent, json.dumps(asdict(row), default=str), reason),
            )
            quarantined += 1
            continue
        conn.execute(
            """INSERT INTO fact_series
               (series_id, geo_id, partner_geo_id, product_code, flow, period,
                period_start, value, unit, currency, fx_vintage, price_basis,
                band, tax_treatment,
                source, source_dataset, reference_period, retrieved_at, run_id,
                redistribution_class, quality_flag)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (row.series_id, row.geo_id, row.partner_geo_id, row.product_code,
             row.flow, row.period, row.period_start, row.value, row.unit,
             row.currency, row.fx_vintage, row.price_basis, row.band,
             row.tax_treatment, row.source,
             row.source_dataset, row.reference_period, row.retrieved_at,
             run_id, row.redistribution_class, row.quality_flag),
        )
        inserted += 1
    conn.commit()
    return inserted, quarantined
