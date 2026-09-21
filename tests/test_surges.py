from observatory.processing.surges import screen

CFG = {"month": {"ratio_vs_mean": 2.5, "ratio_vs_max": 1.5, "min_t": 5000, "min_share": 0.10},
       "quarter": {"ratio_vs_mean": 1.75, "min_t": 5000, "min_share": 0.10}}
SEV = {"high_ratio": 4.0, "high_share": 0.30}
TOTALS = [100_000] * 24


def test_spike_after_flat_baseline_is_a_month_hit():
    values = [10_000] * 23 + [40_000]
    hits = screen(values, TOTALS, CFG, SEV)
    month = [h for h in hits if h["test"] == "month"]
    assert len(month) == 1 and month[0]["index"] == 23
    assert month[0]["ratio"] == 4.0 and month[0]["severity"] == "high"
    assert month[0]["new_origin"] is False


def test_zero_baseline_new_origin_hit_needs_floors():
    values = [0] * 23 + [20_000]
    hits = screen(values, TOTALS, CFG, SEV)
    assert [h["test"] for h in hits] == ["month"]
    assert hits[0]["new_origin"] is True and hits[0]["ratio"] is None
    # same shape below the absolute floor: silent
    assert screen([0] * 23 + [3_000], TOTALS, CFG, SEV) == []
    # same shape but a tiny share of the flow: silent
    assert screen(values, [1_000_000] * 24, CFG, SEV) == []


def test_lumpy_quarterly_cargoes_do_not_fire():
    values = [0, 0, 60_000] * 8          # one vessel every third month, steady level
    hits = screen(values, TOTALS, CFG, SEV)
    assert hits == []


def test_gradual_rise_is_caught_by_the_quarter_test():
    values = [10_000] * 12 + [12_000, 14_000, 16_000, 20_000, 22_000, 24_000]
    hits = screen(values, TOTALS, CFG, SEV)
    tests = {h["test"] for h in hits}
    assert "quarter" in tests and "month" not in tests


from observatory.processing.surges import screen_price

PCFG = {"month": {"drop": 0.20, "min_t": 5000, "min_share": 0.10},
        "quarter": {"drop": 0.15, "min_t": 5000, "min_share": 0.10}}
PSEV = {"high_drop": 0.35, "high_share": 0.30}


def test_price_drop_on_material_flow_is_a_hit():
    qty = [20_000] * 24
    val = [20_000 * 900] * 23 + [20_000 * 600]      # 900 -> 600 EUR/t, -33 %
    hits = screen_price(qty, val, TOTALS, PCFG, PSEV)
    month = [h for h in hits if h["test"] == "month"]
    assert len(month) == 1 and month[0]["index"] == 23
    assert abs(month[0]["drop"] - 1 / 3) < 1e-9 and month[0]["severity"] == "medium"


def test_price_drop_without_baseline_or_volume_is_silent():
    qty = [0] * 23 + [20_000]                         # new origin: no price baseline
    val = [0] * 23 + [20_000 * 500]
    assert screen_price(qty, val, TOTALS, PCFG, PSEV) == []
    qty = [2_000] * 24                                # below the tonnage floor
    val = [2_000 * 900] * 23 + [2_000 * 400]
    assert screen_price(qty, val, TOTALS, PCFG, PSEV) == []


def test_small_price_move_is_silent():
    qty = [20_000] * 24
    val = [20_000 * 900] * 23 + [20_000 * 800]        # -11 %
    assert screen_price(qty, val, TOTALS, PCFG, PSEV) == []
