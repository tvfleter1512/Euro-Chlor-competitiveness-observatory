from observatory.processing.margins import ecu_cash_cost_rows

PARAMS = {"mwh_per_ecu": 2.629, "countries": ["DE", "FR", "BE", "ES"]}
# synthetic figures (the real Argus values are licensed and must not enter this public repo)
ARGUS = {"2024": {"power": 500, "salt": 100, "other": 20, "fixed": 150, "total": 770}}


def test_power_is_measured_price_times_intensity_plus_argus_non_power():
    power = {c: {"2024-S1": 100.0, "2024-S2": 120.0} for c in PARAMS["countries"]}
    (row,) = ecu_cash_cost_rows(power, ARGUS, PARAMS)
    assert row["power_price_eur_mwh"] == 110.0
    assert row["power"] == round(2.629 * 110.0, 1)
    assert row["total"] == round(2.629 * 110.0 + 100 + 20 + 150, 1)
    assert row["argus_total"] == 770


def test_year_skipped_when_a_country_lacks_a_semester():
    power = {c: {"2024-S1": 100.0, "2024-S2": 120.0} for c in PARAMS["countries"]}
    del power["ES"]["2024-S2"]
    assert ecu_cash_cost_rows(power, ARGUS, PARAMS) == []


def test_country_average_is_unweighted():
    prices = {"DE": 120.0, "FR": 70.0, "BE": 90.0, "ES": 80.0}
    power = {c: {"2024-S1": v, "2024-S2": v} for c, v in prices.items()}
    (row,) = ecu_cash_cost_rows(power, ARGUS, PARAMS)
    assert row["power_price_eur_mwh"] == 90.0
