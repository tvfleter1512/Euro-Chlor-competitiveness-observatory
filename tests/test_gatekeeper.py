"""The provenance gatekeeper is the hard constraint (spec §8) — test it directly."""
from datetime import date, datetime, timezone

from observatory.provenance import SeriesRow, _validate


def _row(**overrides):
    base = dict(
        series_id="power.industrial_delivered", geo_id="EU27_2020",
        period="2024-S1", period_start=date(2024, 1, 1), value=95.5,
        unit="EUR/MWh", source="Eurostat", source_dataset="nrg_pc_205",
        reference_period="2024-S1", retrieved_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return SeriesRow(**base)


def test_complete_row_passes():
    assert _validate(_row()) is None


def test_missing_source_rejected():
    assert "source" in _validate(_row(source=""))


def test_missing_retrieved_at_rejected():
    assert "retrieved_at" in _validate(_row(retrieved_at=None))


def test_missing_reference_period_rejected():
    assert "reference_period" in _validate(_row(reference_period=""))


def test_non_numeric_value_rejected():
    assert "not numeric" in _validate(_row(value="n/a"))


def test_none_value_rejected():
    assert _validate(_row(value=None)) is not None


def test_bad_flow_rejected():
    assert "flow" in _validate(_row(flow="both"))


def test_bad_quality_flag_rejected():
    assert "quality_flag" in _validate(_row(quality_flag="fine"))
