from datetime import date

from observatory.processing.dependency import _windows


def test_complete_years_and_rolling_window():
    months = [f"2023-{m:02d}" for m in range(1, 13)] + \
             [f"2024-{m:02d}" for m in range(1, 13)] + \
             ["2025-01", "2025-02", "2025-03"]
    wins = _windows(months, 12)
    labels = [w[0] for w in wins]
    assert labels == ["2023", "2024", "L12M"]
    l12 = wins[-1]
    assert l12[1] == date(2024, 4, 1)          # rolling window starts 2024-04
    assert len(l12[2]) == 12
    assert "2025-03" in l12[2] and "2024-03" not in l12[2]


def test_partial_year_excluded():
    months = [f"2024-{m:02d}" for m in range(1, 12)]   # 11 months only
    wins = _windows(months, 12)
    assert [w[0] for w in wins] == []                  # no complete year, no window
