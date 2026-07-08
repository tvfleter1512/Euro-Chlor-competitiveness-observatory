# European Chlor-Alkali Competitiveness Observatory — Architecture & Build Specification

**Purpose of this document.** This is a build brief to be handed to an autonomous coding agent (Claude Code / agentic runner on the server "yaghi"). It defines *what* to build, *which agents/services* compose it, *which data sources* to use and how to reach them, and *which decisions the human owner must settle first*. It is deliberately opinionated so the agent has a default path, but every hard-coded assumption is flagged for confirmation.

**Owner:** Thomas (Euro Chlor / CEFIC). **Status:** planning — not to be built yet.

---

## 1. What the observatory is

A single "one-stop shop" where Euro Chlor members find, in one place, the data that describes the competitiveness of the European chlor-alkali sector against other world regions:

- **Trade** of the tradable products (caustic soda, PVC, EDC/VCM, chlorinated derivatives) — chlorine itself barely trades, so competitiveness shows up *embedded* in these flows.
- **Electricity cost** — the dominant cash-cost lever — EU vs US, China, Gulf, India, benchmarked as *industrial delivered* price, not just wholesale.
- **Production / capacity / utilisation** ratios, EU vs other regions.
- **Carbon** — EUA price and indirect-cost-compensation (ETS State Aid) benchmarks.

The deliverable is a server-hosted application: scheduled data ingestion → a warehouse → a normalisation/benchmarking layer → an API → a dashboard, with a natural-language query layer on top. Every figure shown carries its source and date.

---

## 2. Two decisions to settle *before* any build

These shape the whole architecture. The agent should stop and ask if they are unresolved.

**2.1 Data licensing model.** Price-reporting agency data (Argus, ICIS, Platts) cannot be freely redistributed to all members. Choose one:
- **(A) Public-data-only observatory** — Eurostat, ENTSO-E, UN Comtrade, EIA, Euro Chlor internal data. No entitlement logic needed. Fastest to ship, fully shareable.
- **(B) Entitlement-aware observatory** — licensed price series included but gated so only members holding the relevant subscription can see them. Requires auth, per-source entitlement checks, and a redistribution review with each PRA.

Recommendation: **build A first**, design the schema so B can be layered on later (see §7 — every series row carries a `redistribution_class`).

**2.2 Source-of-truth hierarchy.** When two sources disagree on the same metric, which wins? This must be declared per metric, not decided ad hoc. Default proposal:
- EU **production/capacity** → Euro Chlor member data is authoritative; external estimates are fallback/cross-check only.
- **Trade** → Eurostat Comext for EU reporters; UN Comtrade for non-EU reporters and mirror checks.
- **Benchmarks / ETS values** → the source legal text (the relevant Communication), never a remembered figure.

This mirrors the WG1 criticality principle already in use (the defining document is the source of truth, spreadsheets are cross-checks).

---

## 3. Design principles (non-negotiable)

1. **Provenance-first.** No value enters the store or reaches the UI without `source`, `source_document/dataset`, `retrieved_at`, and `reference_period`. This is an architectural constraint, not a nicety — see §8.
2. **Graceful degradation.** Each source is an isolated service. A broken source shows as "stale/unavailable" for its metrics only; it never takes down the observatory.
3. **Idempotent, dated ingestion.** Every run is versioned; re-running never corrupts history. Vintages are kept (statistics get revised — Comtrade and Eurostat both restate).
4. **Normalise before comparing.** Units, currencies, and price bases are reconciled in one place, once. Most bad comparisons in this sector come from skipping this (t Cl₂ vs t NaOH vs ECU; dry vs 50 % caustic; FOB vs CFR).
5. **Human-confirmable codes.** Product/HS codes and benchmark constants are configuration, surfaced for review — not buried in code.

---

## 4. System architecture

```
                    ┌───────────────────────── ORCHESTRATOR ─────────────────────────┐
                    │        (schedule, dependency graph, run versioning)            │
                    └────────────────────────────────────────────────────────────────┘
   INGESTION AGENTS (one per source, isolated)          PROCESSING              DELIVERY
   ┌───────────────┐ ┌───────────────┐                 ┌──────────────┐        ┌──────────────┐
   │ Trade agent   │ │ Power-price   │   ─── raw ───▶  │ Normalisation │  ───▶  │ API layer    │
   │ (Comext /     │ │ agent (ENTSO-E│      landing    │ agent         │        │ (REST/GraphQL│
   │  Comtrade)    │ │  / Eurostat / │      zone       ├──────────────┤        └──────┬───────┘
   ├───────────────┤ │  EIA)         │                 │ Validation & │               │
   │ Product-price │ ├───────────────┤   ─── into ──▶  │ provenance   │        ┌──────▼───────┐
   │ agent (PRA)*  │ │ Production &  │      warehouse  │ agent        │        │ Dashboard    │
   ├───────────────┤ │ capacity agent│                 ├──────────────┤        │ (React +     │
   │ Carbon agent  │ │ (Euro Chlor + │                 │ Benchmarking │  ───▶  │  Recharts)   │
   │ (EUA + ETS)   │ │  external)    │                 │ agent        │        ├──────────────┤
   └───────────────┘ └───────────────┘                 └──────────────┘        │ Query agent  │
                                                                                │ (RAG on the  │
                                                                                │  store)      │
                                                                                └──────────────┘
   * PRA = price-reporting agency (Argus/ICIS/Platts) — only under licensing model B
```

**Layered flow:** raw landing zone (immutable, as-fetched) → warehouse (typed, versioned) → semantic/normalised layer → serving API → UI + query agent.

---

## 5. Agent catalogue

Each "agent" is a modular service with a single responsibility, a defined output contract, and its own failure boundary. Ingestion agents write only to the raw landing zone; processing agents read the warehouse and write derived tables.

### 5.1 Ingestion agents

**Trade agent**
- **Sources:** Eurostat Comext (EU reporters, CN8 detail); UN Comtrade (non-EU reporters, world mirror).
- **Job:** pull import/export value + quantity for the product basket (§ Appendix A) by reporter/partner/period; reconcile reporter-vs-partner mirror discrepancies; flag confidentiality-suppressed cells.
- **Output contract:** long-format rows `{product_code, reporter, partner, flow, period, value_eur, quantity, unit, source, retrieved_at}`.
- **Notes:** Comext full datasets can't be pulled whole — must filter. Keep vintages; both sources restate.

**Power-price agent**
- **Sources:** ENTSO-E Transparency Platform (wholesale day-ahead, bidding-zone level); **Eurostat `nrg_pc_205`** (electricity prices for non-household/industrial consumers, incl. bands and tax components); EIA for the US; regional proxies for China/Gulf/India (see §6, flagged).
- **Job:** maintain two distinct series and never conflate them — **(a) wholesale day-ahead** and **(b) industrial *delivered* price** (energy + network + non-recoverable levies). The delivered price is what decides plant economics; the wholesale price is context.
- **Output contract:** `{region/zone, price_type, band, period, price, currency, unit(MWh), tax_treatment, source, retrieved_at}`.

**Product-price agent** *(licensing model B only)*
- **Sources:** Argus / ICIS / Platts feeds for caustic, PVC, EDC, ECU netbacks.
- **Job:** ingest licensed series; tag every row `redistribution_class = licensed` and attach the entitlement key. Under model A this agent is stubbed/disabled.

**Production & capacity agent**
- **Sources:** Euro Chlor member data (authoritative for EU capacity, output, operating rate); external capacity/utilisation for other regions (e.g. ACC for the US, published Asian capacity data — flagged, see §6).
- **Job:** maintain EU capacity/production/utilisation as source of truth; align external-region figures onto the same basis for ratio computation.
- **Output contract:** `{region, metric(capacity|production|utilisation), technology, period, value, unit, source, retrieved_at}`.

**Carbon agent**
- **Sources:** EUA price series; the ETS State Aid indirect-cost-compensation benchmarks from the source Communications.
- **Job:** track EUA; expose the CL (chlorine) electricity-consumption efficiency benchmark and the fallback benchmark **as parameters read from the source legal text**, not hard-coded. The value Thomas works from (chlorine benchmark **1.846 MWh/t**, Communication **2021/C 528/01**) must be sourced from the Communication itself and stored with that citation; the earlier Communication **2020/C 317/04** is the prior reference. Compute indicative indirect-cost compensation given aid intensity, EUA price, and eligible output.
- **Note:** this reuses the exact ETS analysis logic already developed for the Biomca case; treat that as the reference implementation.

### 5.2 Processing agents

**Normalisation agent**
- Aligns **units** (t Cl₂ ↔ t NaOH ↔ ECU; kWh ↔ MWh), **currencies** (single reporting currency + FX vintage), and **price bases** (dry vs 50 % caustic; FOB vs CFR; wholesale vs delivered).
- Publishes a documented conversion registry so every transformation is inspectable. No comparison is computed on un-normalised data.

**Validation & provenance agent** *(the gatekeeper — see §8)*
- Enforces that every row carries complete provenance; rejects rows that don't.
- Outlier and consistency checks (mirror-trade gaps, implausible unit values, revisions beyond a threshold) → flagged, not silently dropped.

**Benchmarking agent**
- Computes the comparative indicators (§9): EU-vs-region electricity ratio, cost-curve position, trade balance by product, utilisation gap, and a composite competitiveness index.
- Every indicator is a defined formula stored as config (like the WG1 M2/M3a formulas), so the methodology is auditable and versioned.

### 5.3 Delivery layer

**Orchestrator** — schedules ingestion per each source's natural cadence (§6), manages the dependency graph (prices normalised before benchmarks), versions every run, and emits run health.

**API layer** — serves normalised series and computed indicators; enforces `redistribution_class` entitlements under model B.

**Dashboard** — React + Recharts (consistent with your existing tooling): electricity comparison, trade balances, utilisation, ETS/carbon, and the composite index. Each chart exposes a source/date panel (the collapsible source-chip pattern you've built before).

**Query agent (RAG)** — natural-language questions answered *strictly* from the store, with source chips exposed and refusal-to-answer when the store lacks grounding. Same grounded-answer discipline as your document chatbot, pointed at structured data.

---

## 6. Data sources reference (access methods verified July 2026)

| Source | Reaches | Access | Auth | Format | Cadence | Notes |
|---|---|---|---|---|---|---|
| **Eurostat dissemination API** | EU industrial electricity price (`nrg_pc_205`), energy, PRODCOM | `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{code}` | none | JSON-stat / SDMX | ~6-monthly (energy prices) | Public open API, no key. Filter server-side. |
| **Eurostat Comext** | EU trade, CN8 detail | `https://ec.europa.eu/eurostat/api/comext/dissemination/...` (separate base) | none | SDMX/JSON-stat | monthly | Full datasets can't be pulled whole — must filter. |
| **UN Comtrade** | non-EU + world mirror trade | comtradeplus.un.org; official `comtradeapicall` Python pkg | subscription key (free tier: ~100k records/call, 500 calls/day) | JSON/CSV | irregular per reporter | Key approval can take days. Premium tier for bulk. |
| **ENTSO-E Transparency** | wholesale day-ahead prices, load, generation, cross-border | `https://web-api.tp.entsoe.eu/api` (python client `entsoe-py`) | free token — register + email transparency@entsoe.eu "Restful API access" | XML (IEC 62325); doc type `A44` = day-ahead | daily (prices ~13:00–15:00 CET) | Wholesale ≠ delivered industrial price — keep separate. |
| **US EIA** | US industrial electricity price, energy | EIA open data API | free API key | JSON | monthly | US comparator. |
| **Euro Chlor internal** | EU capacity, production, utilisation | member data (format TBC — file drop / DB) | internal | TBC | quarterly/annual | **Source of truth** for EU. Confirm ingestion mechanism. |
| **US ACC / Asian capacity** | non-EU production & utilisation | publication / licensed — **FLAGGED, confirm availability & terms** | varies | varies | annual | Needed for production-ratio comparisons; check redistribution. |
| **PRA (Argus/ICIS/Platts)** | product prices, ECU netbacks | licensed feed | subscription | varies | daily/weekly | Model B only; `redistribution_class = licensed`. |
| **EUA / ETS** | carbon price, benchmarks | EUA price feed + source Communications | varies | varies | daily (price) | Benchmarks read from legal text, not memory. |

*Anything marked FLAGGED needs Thomas to confirm the source and its redistribution terms before the agent commits to it.*

---

## 7. Data model (sketch)

A single long/tidy fact table is the backbone; dimensions hang off it.

```
fact_series
  series_id            -- FK to dim_series (what is measured)
  region / zone        -- FK to dim_geo
  product_code         -- FK to dim_product (nullable for pure-electricity/carbon rows)
  period               -- normalised (month/quarter/year)
  value
  unit                 -- normalised unit
  currency             -- normalised, with fx_vintage
  price_basis          -- e.g. dry / 50%-caustic / FOB / CFR / delivered / wholesale
  -- provenance (mandatory, see §8)
  source
  source_document_or_dataset
  reference_period
  retrieved_at
  run_id               -- FK to ingestion run (vintage)
  redistribution_class -- public | licensed  (enables model B)
  quality_flag         -- ok | estimated | suppressed | outlier
```

Keep every `run_id`; never overwrite. Derived indicators live in `fact_indicator` with a `methodology_version` and the formula reference.

---

## 8. Provenance & validation — the hard constraint

This is the part that must not be compromised, because the recurring failure mode in this domain is figures quoted from memory rather than from source.

- The **validation & provenance agent sits between raw and warehouse**. A row missing any mandatory provenance field is rejected to a quarantine table, never silently written.
- Benchmark constants and legal-text values (ETS benchmarks, aid intensities) are stored **with the citation to the Communication and the exact clause**, and the pipeline reads them from there — the agent must not inline a remembered number anywhere in code.
- The UI renders provenance inline (source chip + retrieved date + reference period) on every figure. If provenance is absent, the figure does not render.
- Revisions are diffed against prior vintages; large restatements are surfaced for review rather than absorbed silently.

---

## 9. Competitiveness indicators (define as versioned formulas)

Each is stored as an auditable formula in config, like the WG1 criteria:

1. **Electricity cost ratio** — EU industrial delivered €/MWh ÷ comparator region, per period. (Delivered, not wholesale.)
2. **Embedded-chlorine trade balance** — net trade of caustic, PVC, EDC/VCM, derivatives, as the observable proxy for chlorine competitiveness.
3. **Utilisation gap** — EU operating rate minus comparator region operating rate.
4. **Cost-curve position** — EU cash-cost position on the global cost curve (electricity-driven; needs consumption intensity per tonne — parameterised).
5. **Carbon cost exposure** — EUA cost per tonne net of indirect-cost compensation, EU-only, as a competitiveness drag term.
6. **Composite competitiveness index** — transparent weighted blend of the above; weights are config, published, and versioned. No black-box scoring.

---

## 10. Tech stack & deployment on the server

- **Warehouse:** PostgreSQL (or DuckDB if kept single-node/embedded — both are ample at this data volume).
- **Ingestion agents:** Python services (matches `comtradeapicall`, `entsoe-py`, `eurostat` client availability). One module per source, scheduled by the orchestrator.
- **Orchestration:** a lightweight scheduler (cron for v1; Prefect/Dagster if the dependency graph grows).
- **API:** FastAPI (Python — keeps one language across ingestion and serving).
- **Dashboard:** React + Recharts.
- **Query agent:** RAG over the warehouse + a metrics/semantic layer, grounded strictly in stored series, exposing source chips; refuses when ungrounded.
- **Secrets:** API tokens (Comtrade key, ENTSO-E token, EIA key) in a secrets store / env, never in code.
- **Server networking:** confirm the server's egress allows the source domains (`ec.europa.eu`, `web-api.tp.entsoe.eu`, `comtradeplus.un.org`, EIA). This will need network configuration on yaghi.

---

## 11. Build roadmap

**Phase 0 — Decisions & skeleton.** Settle §2 (licensing model, source-of-truth table). Stand up warehouse + provenance schema + orchestrator skeleton. Wire the provenance gatekeeper *first* so nothing can bypass it later.

**Phase 1 — Public electricity + trade (highest value, no licensing friction).** Power-price agent (ENTSO-E + Eurostat `nrg_pc_205` + EIA) and Trade agent (Comext + Comtrade). Normalisation agent. First dashboard: electricity comparison + trade balances. This alone answers most of the competitiveness question.

**Phase 2 — Production/utilisation + carbon.** Euro Chlor internal ingestion (confirm mechanism); external-region capacity (resolve FLAGGED sources); carbon agent reusing the Biomca ETS logic. Add utilisation and carbon views + the composite index.

**Phase 3 — Query agent + polish.** RAG layer, source-chip UX, revision-diff surfacing, alerting on stale sources.

**Phase 4 (optional) — Licensing model B.** Entitlement checks, PRA ingestion, gated licensed price series.

---

## 12. Open questions for Thomas (resolve before/early in build)

1. **Licensing model A or B** for launch? (§2.1)
2. **Source-of-truth table** — confirm the per-metric hierarchy in §2.2.
3. **Euro Chlor internal data** — what's the ingestion mechanism (secure file drop, database, manual upload) and cadence?
4. **Non-EU production/utilisation** — which sources are licensed/usable, and can they be redistributed to members? (the FLAGGED rows)
5. **Comparator regions** — confirm the set (US, China, Gulf, India) and whether Gulf/China/India electricity uses published tariffs or modelled proxies.
6. **Product basket / codes** — confirm Appendix A against current CN/HS nomenclature.
7. **Reporting currency & FX source** for normalisation.
8. **Hosting/access** — members-only auth on the dashboard from day one, or open within Euro Chlor?

---

## Appendix A — Product basket (starting set — confirm against current CN/HS nomenclature)

These are the tradable products that carry chlor-alkali competitiveness. **Codes below are a starting point and must be verified against the current CN8 / HS classification before ingestion** — do not treat them as authoritative:

- **Caustic soda (sodium hydroxide)** — solid ~2815.11; aqueous/liquid ~2815.12
- **Chlorine** — ~2801.10 (minimal trade; include for completeness)
- **Hydrochloric acid** — ~2806.10
- **EDC (1,2-dichloroethane)** — ~2903.15
- **VCM (vinyl chloride)** — ~2903.21
- **PVC** — ~3904.10 / 3904.21 / 3904.22
- **Sodium hypochlorite / bleach** — under ~2828
- **Chlorates** — under ~2829

For each, the Trade agent should carry the CN8 detail where Comext provides it and roll up to HS6 for Comtrade comparability.

## Appendix B — Key dataset handles (verify current)

- Eurostat industrial electricity price: `nrg_pc_205` (non-household consumers).
- Eurostat trade: Comext DS-prefixed datasets via the `/comext/dissemination` endpoint.
- ENTSO-E day-ahead price: document type `A44`, process type `A01`, per bidding-zone EIC code.
- UN Comtrade: `comtradeapicall` — `getFinalData` / bulk download with subscription key.
- ETS benchmarks: chlorine CL benchmark **1.846 MWh/t** and the fallback benchmark — **read from Communication 2021/C 528/01 directly**, store with citation; prior reference 2020/C 317/04.

---

*This spec favours the public-data path (model A), a provenance-first pipeline, and phased delivery starting with electricity + trade. The agent should treat every FLAGGED item and every code in Appendix A as requiring human confirmation, and must never hard-code a benchmark or legal value that should be read from its source document.*
