"""Normalisation agent (spec §5.2) — the single place units/currencies/bases reconcile.

Every conversion applied here is declared in config/conversions.yaml. No
comparison downstream (benchmarking, API, dashboard) computes on un-normalised
data: benchmarking calls to_eur()/aligned helpers, never raw cross-currency math.
"""
from datetime import date

from observatory.settings import load_config


class FXError(Exception):
    """No usable FX vintage — the caller must degrade gracefully, not guess."""


def load_fx(conn) -> dict[tuple[str, date], float]:
    """Latest-vintage monthly-average rates: (currency, month_start) -> quote per EUR."""
    rows = conn.execute("SELECT quote_currency, rate_date, rate FROM v_fx_latest").fetchall()
    return {(r["quote_currency"], r["rate_date"]): float(r["rate"]) for r in rows}


def to_eur(value: float, currency: str, month_start: date, fx: dict) -> tuple[float, date]:
    """Convert to EUR using the monthly-average rate of the reference period.

    Returns (eur_value, fx_vintage). Falls back to the most recent earlier month
    (rates lag a few weeks); raises FXError if nothing usable exists.
    """
    if currency in (None, "EUR"):
        return value, month_start
    rate = fx.get((currency, month_start))
    vintage = month_start
    if rate is None:
        earlier = [d for (c, d) in fx if c == currency and d < month_start]
        if not earlier:
            raise FXError(f"no ECB rate for {currency} at or before {month_start}")
        vintage = max(earlier)
        rate = fx[(currency, vintage)]
    return value / rate, vintage


def period_months(period: str, period_start: date) -> list[date]:
    """First days of the months a period covers: 1 (monthly), 3 (quarter), 6 (half-year), 12 (year)."""
    n = 12 if period.isdigit() else 6 if "-S" in period else 3 if "-Q" in period else 1
    return [date(period_start.year + (period_start.month - 1 + i) // 12,
                 (period_start.month - 1 + i) % 12 + 1, 1) for i in range(n)]


def to_eur_period(value: float, currency: str, period: str, period_start: date, fx: dict) -> float:
    """Like to_eur, but a period longer than a month (year, half-year, quarter) is
    converted at the mean of the ECB monthly rates it covers (EUR per unit averaged),
    so an annual tariff is not converted at January's rate. Falls back to to_eur
    when none of those months has a rate yet."""
    if currency in (None, "EUR"):
        return value
    inverse = [1 / fx[(currency, m)] for m in period_months(period, period_start) if (currency, m) in fx]
    if inverse:
        return value * sum(inverse) / len(inverse)
    return to_eur(value, currency, period_start, fx)[0]


def semester_of(month_start: date) -> tuple[str, date]:
    """Map a monthly period onto its semester ('2023-S1', start date) for
    alignment with the semi-annual Eurostat delivered-price series."""
    if month_start.month <= 6:
        return f"{month_start.year}-S1", date(month_start.year, 1, 1)
    return f"{month_start.year}-S2", date(month_start.year, 7, 1)


def conversion_registry() -> dict:
    return load_config("conversions")
