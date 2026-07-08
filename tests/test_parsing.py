from datetime import date

from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start


def test_jsonstat_flat_index_maps_to_coords():
    payload = {
        "id": ["geo", "time"],
        "size": [2, 3],
        "dimension": {
            "geo": {"category": {"index": {"DE": 0, "FR": 1}}},
            "time": {"category": {"index": {"2023-S1": 0, "2023-S2": 1, "2024-S1": 2}}},
        },
        # row-major: last dim fastest -> flat 4 = geo FR (4//3=1), time 2023-S2 (4%3=1)
        "value": {"0": 10.0, "4": 99.0},
    }
    obs = dict()
    for coords, value in iter_observations(payload):
        obs[(coords["geo"], coords["time"])] = value
    assert obs[("DE", "2023-S1")] == 10.0
    assert obs[("FR", "2023-S2")] == 99.0


def test_period_start_variants():
    assert period_start("2023-S1") == date(2023, 1, 1)
    assert period_start("2023-S2") == date(2023, 7, 1)
    assert period_start("2023-Q3") == date(2023, 7, 1)
    assert period_start("2023-05") == date(2023, 5, 1)
    assert period_start("2023") == date(2023, 1, 1)
