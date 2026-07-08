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


def semester_of(month_start: date) -> tuple[str, date]:
    """Map a monthly period onto its semester ('2023-S1', start date) for
    alignment with the semi-annual Eurostat delivered-price series."""
    if month_start.month <= 6:
        return f"{month_start.year}-S1", date(month_start.year, 1, 1)
    return f"{month_start.year}-S2", date(month_start.year, 7, 1)


def conversion_registry() -> dict:
    return load_config("conversions")
