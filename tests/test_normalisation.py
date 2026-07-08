from datetime import date

import pytest

from observatory.processing.normalisation import FXError, semester_of, to_eur

FX = {("USD", date(2024, 1, 1)): 1.09, ("USD", date(2023, 12, 1)): 1.08}


def test_eur_passthrough():
    assert to_eur(100.0, "EUR", date(2024, 1, 1), FX) == (100.0, date(2024, 1, 1))


def test_usd_converted_with_month_vintage():
    value, vintage = to_eur(109.0, "USD", date(2024, 1, 1), FX)
    assert value == pytest.approx(100.0)
    assert vintage == date(2024, 1, 1)


def test_falls_back_to_most_recent_earlier_month():
    value, vintage = to_eur(108.0, "USD", date(2024, 2, 1), FX)
    assert vintage == date(2024, 1, 1)
    assert value == pytest.approx(108.0 / 1.09)


def test_no_rate_raises_instead_of_guessing():
    with pytest.raises(FXError):
        to_eur(1.0, "JPY", date(2024, 1, 1), FX)


def test_semester_alignment():
    assert semester_of(date(2024, 3, 1)) == ("2024-S1", date(2024, 1, 1))
    assert semester_of(date(2024, 11, 1)) == ("2024-S2", date(2024, 7, 1))
