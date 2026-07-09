-- European Chlor-Alkali Competitiveness Observatory — warehouse schema
-- Provenance-first: fact rows without complete provenance are structurally impossible
-- (NOT NULL constraints) and the application gatekeeper quarantines them earlier.

CREATE TABLE IF NOT EXISTS ingestion_run (
    run_id            BIGSERIAL PRIMARY KEY,
    agent             TEXT        NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    status            TEXT        NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'success', 'failed', 'partial', 'skipped')),
    rows_ingested     INTEGER     NOT NULL DEFAULT 0,
    rows_quarantined  INTEGER     NOT NULL DEFAULT 0,
    notes             TEXT
);

-- Immutable as-fetched payloads. Never updated, never deleted.
CREATE TABLE IF NOT EXISTS raw_landing (
    id            BIGSERIAL   PRIMARY KEY,
    run_id        BIGINT      NOT NULL REFERENCES ingestion_run(run_id),
    source        TEXT        NOT NULL,
    request_url   TEXT,
    payload       JSONB       NOT NULL,
    retrieved_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_series (
    series_id   TEXT PRIMARY KEY,   -- e.g. 'power.industrial_delivered'
    name        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('power', 'gas', 'trade', 'production', 'carbon', 'fx', 'price', 'demand', 'structure', 'freight')),
    description TEXT
);

CREATE TABLE IF NOT EXISTS dim_geo (
    geo_id TEXT PRIMARY KEY,        -- 'EU27_2020', 'DE', 'US', 'CN', 'GULF', 'IN', bidding zones
    name   TEXT NOT NULL,
    kind   TEXT NOT NULL CHECK (kind IN ('country', 'region', 'bidding_zone', 'world'))
);

CREATE TABLE IF NOT EXISTS dim_product (
    product_code TEXT PRIMARY KEY,  -- CN8 or HS6 digit string
    nomenclature TEXT NOT NULL CHECK (nomenclature IN ('CN8', 'HS6', 'PRODCOM')),
    name         TEXT NOT NULL,
    hs6          TEXT,              -- roll-up key for Comtrade comparability
    confirmed    BOOLEAN NOT NULL DEFAULT FALSE  -- human-confirmable codes (§3.5)
);

CREATE TABLE IF NOT EXISTS fact_series (
    id              BIGSERIAL PRIMARY KEY,
    series_id       TEXT    NOT NULL REFERENCES dim_series(series_id),
    geo_id          TEXT    NOT NULL REFERENCES dim_geo(geo_id),
    partner_geo_id  TEXT    REFERENCES dim_geo(geo_id),   -- trade only
    product_code    TEXT    REFERENCES dim_product(product_code),
    flow            TEXT    CHECK (flow IN ('import', 'export')),
    period          TEXT    NOT NULL,                     -- '2023-05', '2023-Q2', '2023-S1', '2023'
    period_start    DATE    NOT NULL,
    value           NUMERIC NOT NULL,
    unit            TEXT    NOT NULL,
    currency        TEXT,
    fx_vintage      DATE,
    price_basis     TEXT,   -- 'delivered' | 'wholesale' | 'dry' | '50pct' | 'FOB' | 'CFR'
    band            TEXT,   -- power: consumption band (nrg_pc_205 nrg_cons code)
    tax_treatment   TEXT,   -- power: 'I_TAX' | 'X_VAT' | 'X_TAX' (Eurostat convention)
    -- provenance: mandatory, enforced here AND by the gatekeeper
    source          TEXT        NOT NULL,
    source_dataset  TEXT        NOT NULL,
    reference_period TEXT       NOT NULL,
    retrieved_at    TIMESTAMPTZ NOT NULL,
    run_id          BIGINT      NOT NULL REFERENCES ingestion_run(run_id),
    redistribution_class TEXT   NOT NULL DEFAULT 'public'
                      CHECK (redistribution_class IN ('public', 'licensed')),
    quality_flag    TEXT        NOT NULL DEFAULT 'ok'
                      CHECK (quality_flag IN ('ok', 'estimated', 'suppressed', 'outlier'))
);

CREATE INDEX IF NOT EXISTS idx_fact_series_lookup
    ON fact_series (series_id, geo_id, period_start);
CREATE INDEX IF NOT EXISTS idx_fact_series_trade
    ON fact_series (product_code, flow, period_start) WHERE product_code IS NOT NULL;

-- Rows rejected by the provenance/validation gatekeeper. Nothing is silently dropped.
CREATE TABLE IF NOT EXISTS quarantine (
    id             BIGSERIAL   PRIMARY KEY,
    run_id         BIGINT      REFERENCES ingestion_run(run_id),
    agent          TEXT,
    row            JSONB       NOT NULL,
    reason         TEXT        NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_rate (
    quote_currency TEXT        NOT NULL,   -- rate = quote per 1 EUR (ECB convention)
    rate_date      DATE        NOT NULL,
    rate           NUMERIC     NOT NULL,
    source         TEXT        NOT NULL,
    retrieved_at   TIMESTAMPTZ NOT NULL,
    run_id         BIGINT      NOT NULL REFERENCES ingestion_run(run_id),
    PRIMARY KEY (quote_currency, rate_date, run_id)
);

CREATE TABLE IF NOT EXISTS fact_indicator (
    id                  BIGSERIAL PRIMARY KEY,
    indicator_id        TEXT    NOT NULL,       -- key into config/indicators.yaml
    methodology_version TEXT    NOT NULL,
    geo_id              TEXT    REFERENCES dim_geo(geo_id),
    comparator_geo_id   TEXT    REFERENCES dim_geo(geo_id),
    product_code        TEXT    REFERENCES dim_product(product_code),
    period              TEXT    NOT NULL,
    period_start        DATE    NOT NULL,
    value               NUMERIC NOT NULL,
    unit                TEXT,
    inputs              JSONB,                  -- provenance of every input series
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    run_id              BIGINT REFERENCES ingestion_run(run_id)
);

CREATE INDEX IF NOT EXISTS idx_fact_indicator_lookup
    ON fact_indicator (indicator_id, period_start);

-- Legal-text constants (ETS benchmarks etc.), stored with citation, never inlined in code.
CREATE TABLE IF NOT EXISTS benchmark_constant (
    key        TEXT PRIMARY KEY,
    value      NUMERIC NOT NULL,
    unit       TEXT,
    citation   TEXT NOT NULL,     -- e.g. 'Communication 2021/C 528/01, Annex I'
    source_url TEXT,
    confirmed  BOOLEAN NOT NULL DEFAULT FALSE
);

-- Latest vintage per logical observation (revisions kept underneath, never overwritten).
CREATE OR REPLACE VIEW v_series_latest AS
SELECT DISTINCT ON (series_id, geo_id, COALESCE(partner_geo_id, ''),
                    COALESCE(product_code, ''), COALESCE(flow, ''),
                    COALESCE(band, ''), COALESCE(tax_treatment, ''), period)
       *
FROM fact_series
ORDER BY series_id, geo_id, COALESCE(partner_geo_id, ''),
         COALESCE(product_code, ''), COALESCE(flow, ''),
         COALESCE(band, ''), COALESCE(tax_treatment, ''), period, run_id DESC;

CREATE OR REPLACE VIEW v_fx_latest AS
SELECT DISTINCT ON (quote_currency, rate_date) *
FROM fx_rate
ORDER BY quote_currency, rate_date, run_id DESC;

-- Per-agent health: last run status and freshness, for graceful-degradation display.
CREATE OR REPLACE VIEW v_source_health AS
SELECT DISTINCT ON (agent)
       agent, run_id, started_at, finished_at, status, rows_ingested, rows_quarantined, notes
FROM ingestion_run
ORDER BY agent, run_id DESC;
