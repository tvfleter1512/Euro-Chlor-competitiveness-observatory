from observatory.ingestion.census_trade import IMPORT_FIELDS, parse_table
from observatory.processing.freight import rolling_freight


def months(year, n=12):
    return [f"{year + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}" for m in range(1, n + 1)]


def test_mirror_uses_summed_window_not_mean_of_ratios():
    ms = months(2025)
    # arrival: 1,000 t/month at 300 EUR/t except one big cheap month; departure flat 250 EUR/t
    arrival = {m: (300_000.0, 1000.0) for m in ms}
    arrival[ms[5]] = (2_000_000.0, 10_000.0)          # 200 EUR/t on 10x the tonnage
    departure = {m: (250_000.0, 1000.0) for m in ms}
    departure[ms[5]] = (1_500_000.0, 10_000.0)         # 150 EUR/t
    rows = rolling_freight(arrival, departure)
    last = rows[-1]
    assert last["period"] == "2025-12" and last["months"] == 12
    cif = (11 * 300_000 + 2_000_000) / 21_000           # ~252: not the mean of ratios (~292)
    fob = (11 * 250_000 + 1_500_000) / 21_000
    assert abs(last["value"] - (cif - fob)) < 1e-9
    assert [r["period"] for r in rows][0] == "2025-09"   # first month with 9 of 12 usable


def test_mirror_skips_thin_windows_and_one_sided_months():
    ms = months(2025)
    arrival = {m: (5_000.0, 50.0) for m in ms}           # 600 t over the year: below 1,000 t
    departure = {m: (4_000.0, 50.0) for m in ms}
    assert rolling_freight(arrival, departure) == []
    arrival = {m: (300_000.0, 1000.0) for m in ms}
    departure = {m: (250_000.0, 1000.0) for m in ms[:8]}  # only 8 months on both sides
    assert rolling_freight(arrival, departure) == []


def test_customs_charges_per_tonne():
    ms = months(2025)
    charges = {m: (45_000.0, 1000.0) for m in ms}
    rows = rolling_freight({}, charges=charges)
    assert rows[-1]["value"] == 45.0 and rows[-1]["tonnes"] == 12_000.0


def test_census_imports_keep_charges():
    table = [["CTY_CODE", "CTY_NAME", "GEN_VAL_MO", "GEN_QY1_MO", "GEN_CHA_MO", "UNIT_QY1", "time"],
             ["0003", "EUROPEAN UNION", "700000", "600000", "60000", "KG", "2025-10"],
             ["0003", "EUROPEAN UNION", "300000", "400000", "40000", "KG", "2025-10"]]
    [row] = parse_table(table, "390410", IMPORT_FIELDS)
    assert (row["usd"], row["tonnes"], row["charges_usd"]) == (1_000_000.0, 1000.0, 100_000.0)


def test_mirror_drops_windows_where_the_two_sides_count_different_tonnes():
    ms = months(2025)
    arrival = {m: (300_000.0, 1000.0) for m in ms}
    departure = {m: (500_000.0, 2000.0) for m in ms}      # exporter reports twice the tonnes
    assert rolling_freight(arrival, departure) == []


def test_mirror_drops_implausible_gaps():
    ms = months(2025)
    arrival = {m: (300_000.0, 1000.0) for m in ms}
    assert rolling_freight(arrival, {m: (350_000.0, 1000.0) for m in ms}) == []   # negative
    assert rolling_freight(arrival, {m: (100_000.0, 1000.0) for m in ms}) == []   # 2/3 of landed price
    expensive = {m: (8_000_000.0, 1000.0) for m in ms}   # 8,000 EUR/t landed
    assert rolling_freight(expensive, {m: (7_000_000.0, 1000.0) for m in ms}) == []   # 1,000 EUR/t gap
