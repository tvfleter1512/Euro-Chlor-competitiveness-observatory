# European Chlor-Alkali Competitiveness Observatory

One-stop shop for Euro Chlor members: trade, electricity cost, production/capacity,
and carbon data describing EU chlor-alkali competitiveness vs other world regions.
Full build brief: [`euro-chlor-observatory-architecture.md`](euro-chlor-observatory-architecture.md).

**Decisions locked 2026-07-08** (owner: Thomas):
licensing **model A** (public data only, schema B-ready) · **PostgreSQL** ·
comparators **US + CN/Gulf/IN** (non-US via curated proxies, always `estimated`) ·
**EUR + ECB** monthly-average FX · history **from 2015** · file-drop for Euro Chlor
internal data · no dashboard auth in v1.

## Architecture

```
ingestion agents (isolated, one per source)
   ecb_fx · eurostat_power · eia_power · entsoe_power · proxy_power
   comext_trade · comtrade_trade · eurochlor_drop
        │  raw_landing (immutable)  →  provenance gatekeeper  →  fact_series (vintaged)
        ▼
processing: normalisation (config/conversions.yaml) → benchmarking (config/indicators.yaml)
        ▼
FastAPI (/api/*) → React+Recharts dashboard (electricity · trade · sources)
```

- **Provenance-first**: rows missing source/dataset/reference-period/retrieved-at are
  quarantined, never written (`observatory/provenance.py` is the only write path).
- **Vintages**: every run keeps its `run_id`; `v_series_latest` serves the newest,
  history is never overwritten.
- **Graceful degradation**: agents without credentials report `dormant`; a failing
  source never blocks the rest.

## Run

```bash
cp .env.example .env                    # add API keys as they arrive
ops/start.sh                            # postgres (port 5433) + API + dashboard on :8300
.venv/bin/python -m observatory.orchestrator.run --list    # agent readiness
.venv/bin/python -m observatory.orchestrator.run --all     # full ingestion + benchmarks
crontab ops/crontab.example             # scheduled operation
.venv/bin/python -m pytest tests/      # test suite
```

Dashboard: `cd dashboard && npm install && npm run build` (dev: `npm run dev`).

## Activating dormant agents

| Agent | Needs | Where |
|---|---|---|
| `eia_power` (US) | `EIA_KEY` | instant: eia.gov/opendata/register.php |
| `entsoe_power` (wholesale) | `ENTSOE_TOKEN` | register + email transparency@entsoe.eu |
| `comtrade_trade` (non-EU) | `COMTRADE_KEY` | comtradeplus.un.org free tier |
| `proxy_power` (CN/Gulf/IN) | curated CSVs | `data/proxy_tariffs/` (see TEMPLATE.csv) |
| `eurochlor_drop` (Phase 2) | member data CSVs | `data/eurochlor_drop/` (see TEMPLATE.csv) |

## Human-confirmable configuration

- `config/product_basket.yaml` — CN8/HS6 codes, all `confirmed: false` until verified
  against current nomenclature (surfaced on the dashboard's Sources tab).
- `config/conversions.yaml` — unit/currency conversion registry (ECU composition flagged).
- `config/indicators.yaml` — versioned indicator formulas, published weights.
- `config/source_of_truth.yaml` — per-metric authority hierarchy (§2.2, confirmed).

## Database

Project-owned Postgres cluster in `pgdata/` on **port 5433** (no sudo needed).
To migrate to the system cluster: `sudo -u postgres psql -c "CREATE ROLE tva LOGIN CREATEDB"
-c "CREATE DATABASE observatory OWNER tva"`, update `DATABASE_URL`, re-run
`python -m observatory.bootstrap` and `--all`.
