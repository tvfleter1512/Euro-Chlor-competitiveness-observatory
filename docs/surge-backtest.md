# Trade-surge detector — calibration backtest (21 Sep 2026)

Detector: `observatory/processing/surges.py`, thresholds in `config/surges.yaml` (v1.0, not yet
owner-confirmed). Data: Eurostat Comext EU27 monthly tonnes, 2015-01 → 2026-07, all 11 basket
CN8 codes, both flows, every extra-EU partner plus the EXTRA_EU aggregate.

## Tests

- **month** — latest month ≥ 2.5 × mean of the previous 12 months AND ≥ 1.5 × their maximum,
  AND ≥ 5 kt AND ≥ 10 % of the extra-EU flow that month. The max guard suppresses lumpy cargo
  patterns (one lye vessel a quarter) that would otherwise fire every delivery month.
- **quarter** — mean of the latest 3 months ≥ 1.75 × mean of the 12 months before them, same
  floors (share over the 3-month window). Catches gradual ramps the month test misses.
- **aggregate** (EXTRA_EU): 1.5 × mean and 1.15 × max (month), 1.3 × (quarter), 10 kt floor.
- Severity `high` if ratio ≥ 4 or share ≥ 30 %, else `medium`.

## Backtest result (2015–2026)

| Metric | Result |
|---|---|
| Total hits, all periods | 576 |
| Mean hits per month with data, 2019+ | 5.1 |
| Busiest months | 2025-10 (15), 2025-12 (12), 2025-11 (11) — the Asian PVC surge |
| Hits in the alert window (2026-05 → 07) | 19 rows → 9 grouped signals in the digest |

Must-flag checks:

| Case | Flagged? |
|---|---|
| Caustic lye imports from China, Jul 2026 (74 kt) | yes — month ×39.8, share 43 %, high; quarter ×31 |
| US PVC import surge 2022 | yes — quarter test from 2022-05, high from 2022-11 |
| Korea PVC import surge 2025 | yes — month 2025-05/06/10, quarter 2025-05 → 2026-02 |
| US lye imports Jun–Jul 2026 (43–48 kt) | **no, by design** — within its own 12-month range (mean ≈ 55 kt/month); the member noticed the aggregate rise, which the China row explains |

Unit tests: `tests/test_surges.py` (spike, zero-baseline with floors, lumpy cargoes, gradual rise).

## Reading the numbers

- A `new origin` hit means the partner shipped nothing in the previous 12 months.
- Comext revises the latest 3–6 months; a hit can disappear or appear on revision. Alerts are
  upserted (same key → updated value, no second notification).
- Lye is screened as-traded tonnes (not dry-normalised); ratios are unaffected, floors are not.

## Open decisions for the owner

1. Confirm or adjust the four threshold sets (then set `confirmed: true`).
2. Whether the EXTRA_EU aggregate hits should notify (currently yes, at `medium`).
3. Whether to add a unit-value (price-drop) screen — not built; cheap to add on the same grid.
