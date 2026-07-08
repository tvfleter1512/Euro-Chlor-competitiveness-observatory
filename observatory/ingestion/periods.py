"""Period-string parsing shared by agents ('2023-05', '2023-S1', '2023-Q2', '2023')."""
from datetime import date


def period_start(period: str) -> date:
    period = period.strip()
    if "-S" in period:
        year, half = period.split("-S")
        return date(int(year), 1 if half == "1" else 7, 1)
    if "-Q" in period:
        year, q = period.split("-Q")
        return date(int(year), (int(q) - 1) * 3 + 1, 1)
    if "-" in period:
        year, month = period.split("-")[:2]
        return date(int(year), int(month), 1)
    return date(int(period), 1, 1)
