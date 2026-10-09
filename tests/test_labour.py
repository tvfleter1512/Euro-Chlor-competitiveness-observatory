from observatory.processing.labour import aggregate_per_employee, per_employee, rebase


def test_per_employee_skips_missing_or_zero_headcount():
    assert per_employee({"2023": 100.0, "2024": 120.0, "2025": 5.0},
                        {"2023": 2000, "2024": 0}, 1000) == {"2023": 50.0}


def test_aggregate_needs_every_country_in_the_year():
    wages = {"DE": {"2023": 100.0, "2024": 110.0}, "FR": {"2023": 50.0}}
    emp = {"DE": {"2023": 1000, "2024": 1000}, "FR": {"2023": 1000}}
    assert aggregate_per_employee(wages, emp, ["DE", "FR"], 1000) == {"2023": 75.0}


def test_rebase_to_base_year_or_nothing():
    assert rebase({"2021": 80.0, "2024": 100.0}, "2021") == {"2021": 100.0, "2024": 125.0}
    assert rebase({"2024": 100.0}, "2021") == {}
