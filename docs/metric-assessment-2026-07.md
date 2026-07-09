# Critical Assessment — European Chlor-Alkali Competitiveness Observatory

*Prepared for the Euro Chlor Management Committee, July 2026. Produced by an AI review agent (Claude) with web-verified sources; verify licensed-source references before procurement decisions.*

## 1. Critical assessment of current metrics

### 1.1 Industrial delivered electricity price, EU vs US (Eurostat nrg_pc_205 / EIA)

**What it answers well.** Direction and rough magnitude of the structural energy-cost handicap — the single number most MC members quote in Brussels advocacy. The peak-to-now trajectory (1.99× → 1.45×) is genuinely useful narrative evidence.

**Blind spots.** (a) The ≥150 GWh band is a thin survey cell in several member states, and X_VAT still embeds levies and network charges that actual chlor-alkali sites are partially exempted from (German EEG/network-fee reductions, French electro-intensive regimes) — so the EU figure overstates what members pay. (b) EIA's industrial retail average is dominated by mid-size customers; a Gulf Coast electrolyser buying at wholesale-plus under cost-of-service or PPA structures pays less, so the ratio likely **understates** the true gap — an uncomfortable asymmetry both directions. (c) A price ratio without consumption intensity says nothing about €/tonne economics. (d) EU-average hides the France/Germany dispersion that actually drives site decisions.

**Improvement.** Translate to €/t ECU using a parameterised intensity (~2.5–2.7 MWh/ECU membrane); show per-country bands; add ENTSO-E baseload + typical sourcing premium as a cross-check series; document known exemption regimes as adjustment ranges rather than pretending X_VAT is "the" paid price.

### 1.2 Embedded-chlorine trade balance (Comext, monthly)

**What it answers well.** Where chlorine competitiveness surfaces — the derivative flows. Product-level deterioration (caustic lye −189 M€/12m) is a legitimate early-warning signal, monthly and free.

**Blind spots.** (a) It conflates demand weakness with competitiveness loss: in a European construction recession, PVC imports fall and the balance "improves" while the industry shrinks. Without production/utilisation alongside, the MC can read decline as recovery. (b) Value terms flatter or punish depending on the price cycle — a caustic price crash shrinks the € deficit while tonnage deficits widen. (c) The PVC surplus partly reflects EU anti-dumping measures on US/Egyptian PVC, not underlying cost position. (d) Caustic tonnes mix 50% lye and solid — un-normalised tonnage comparisons are wrong by 2×. (e) No intra-EU view: extra-EU balance misses displacement of EU producers *within* the single market by import-fed traders.

**Improvement.** Publish € and dry-tonne series together; express net trade as a share of EU apparent consumption (needs PRODCOM, §2); convert the basket to chlorine-equivalent tonnes for one headline "embedded Cl₂ flow"; annotate trade-defence measures on the charts.

### 1.3 EU Commission Core Dependency Indicators (CDI1–3)

**What it answers well.** It speaks the Commission's own screening language (SWD(2021) 352), which is exactly what advocacy to DG GROW/DG TRADE requires. Flagging sodium chlorate (0.75) and EDC (0.56) concentration is decision-relevant.

**Blind spots.** (a) Value-based HHIs can diverge badly from tonnage when unit values differ by supplier; compute both. (b) VCM "HHI = 1.0, fully dependent" is a single **Norwegian** supplier — intra-EEA, allied, pipeline-integrated. Presenting that unannotated to an MC (or worse, to the Commission) invites ridicule; supplier-risk weighting matters more than raw concentration. (c) CDI3 proxies EU substitution capacity by EU *exports* — but with European operating rates near 61%, idle capacity is the real substitution margin; CDI3 systematically overstates dependency for an under-utilised industry, which cuts against the advocacy case for keeping capacity open. (d) The config itself says `confirmed: false` on thresholds — do not externalise until verified against the SWD.

**Improvement.** Parallel tonnage-based CDIs; EEA/allied-supplier tagging; a capacity-headroom-adjusted CDI3 variant; verify thresholds before any external use.

### 1.4 Partner market shares and import unit values

**What it answers well.** Who is taking share (US caustic, Chinese PVC pre-duties) and whether import prices are undercutting — the closest free proxy to a price-pressure signal.

**Blind spots.** (a) Unit values on CN8 baskets mix grades (PVC suspension vs emulsion vs compounds) — "price" moves may be mix moves. (b) Caustic €/t not normalised to 100% NaOH is meaningless across partners shipping lye vs beads. (c) CIF import values embed freight: a freight spike reads as lost import competitiveness when nothing changed FOB. (d) Small monthly flows generate wild unit values; (e) Rotterdam effect distorts partner attribution (goods entering via NL credited to the shipper, consumed elsewhere).

**Improvement.** Dry-basis normalisation via the conversions registry; suppress/flag unit values below a volume floor; mirror-check against Comtrade partner-side exports; benchmark import unit values against a domestic price proxy (PRODCOM value/volume) to make "undercutting" quantitative.

## 2. What is missing — prioritized data additions

### P1 — decision-critical, feasible now

**2.1 EU production, operating rate and caustic stocks — already public, ingest immediately.** The spec defers utilisation to a Phase-2 member file-drop, but Euro Chlor itself already publishes monthly chlorine production, plant operating rate, and caustic stock levels at [eurochlor.org/production](https://www.eurochlor.org/production/) (e.g. April 2026: 629,642 t; operating rates ~61–64% through 2025). This is the single most important missing context: it converts the trade balance from ambiguous to interpretable and enables the utilisation-gap indicator now. Free, scrapes into the existing ingestion pattern; the member file-drop later becomes the higher-granularity authoritative layer. *Feasibility: trivial.*

**2.2 Natural-gas price spread (TTF vs Henry Hub).** Gas sets the marginal EU power price and is the US competitor's feedstock/energy input — it is the *causal* variable behind the electricity ratio. Sources: Eurostat [`nrg_pc_203`](https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_203/default/table?lang=en) (industrial delivered gas, same API pattern as nrg_pc_205, free) plus the World Bank Commodity Markets ["Pink Sheet"](https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/world-bank-commodities-price-data-the-pink-sheet) — monthly TTF and Henry Hub series, free, downloadable XLS/PDF. *Feasibility: fits existing Eurostat agent; Pink Sheet is one small new fetcher.*

**2.3 ECU cash-margin proxy.** Electricity price ratios do not answer "can a European ECU make money?" A publishable public-data proxy: (caustic export/import unit value, dry basis — already ingested) + an assumed chlorine value via PVC/EDC unit values, minus delivered power × MWh/ECU intensity, minus net carbon cost. All inputs are already in or planned for the warehouse; the formula belongs in `indicators.yaml` with the intensity as confirmable config. Upgrade path under model B: [Chemical Market Analytics World Analysis – Chlor-Alkali](https://chemicalmarketanalytics.com/products/wa-chlor-alkali/) or ICIS pricing (licensed, redistribution-gated). *Feasibility: pure benchmarking-agent work, no new source needed for v1.*

**2.4 China module: output, price, exports.** China is ~half of world capacity and the marginal exporter; no EU competitiveness view is credible without it. Verified free sources: NBS monthly caustic output (≈3.7–4.0 Mt/month, reported via NBS releases and secondary aggregators), [SunSirs daily 32% membrane caustic spot price](https://www.sunsirs.com/uk/prodetail-368.html) (RMB/t, free web series, ~10-year history), and China's export volumes/destinations via the already-planned Comtrade key (reporter 156). Together these reveal whether Chinese export pressure is cost-driven or overcapacity-driven. *Feasibility: SunSirs/NBS need small scrapers with `estimated`-style caveats; Comtrade fits the existing agent.*

### P2 — high value, moderate effort

**2.5 Capacity-events tracker (EU closures, US Gulf expansions).** MC decisions (advocacy urgency, investment signalling) hinge on discrete events — a curated, dated table of announced closures, conversions and expansions per region, each row with a press-release/filing URL, maintained manually in config (the provenance model already supports this). No single free API exists; ACC and consultancy capacity databases are licensed. A curated table is honest and cheap. *Feasibility: manual, ~1 hour/month.*

**2.6 Demand-side indicators.** Distinguish "we are uncompetitive" from "our customers are in recession": Eurostat [`sts_copr_m`](https://ec.europa.eu/eurostat/databrowser/view/sts_copr_m/default/table?lang=en) (monthly construction output — PVC demand) and `sts_inpr_m` production-in-industry at NACE 17 (paper — caustic/chlorate demand) and NACE 20. Free, same Eurostat API. *Feasibility: trivial extension of the existing agent.*

**2.7 CBAM exposure flag on the basket.** Verified status: organic chemicals and polymers were **excluded** from CBAM Annex I (Regulation (EU) 2023/956, [EUR-Lex summary](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=legissum%3A4696271)); the Commission must assess extension to organic chemicals/polymers by end-2027, with ETS-wide coverage ambition by 2030 (see also [Sandbag, Nov 2025](https://sandbag.be/2025/11/25/chemicals-in-the-cbam-time-to-step-up/)). For the MC this is a live advocacy question — the basket currently gets EU carbon costs with **no** border adjustment. Implement as a per-product `cbam_status` field plus a monitored review-milestone note. *Feasibility: config + qualitative tracking.*

**2.8 EUA price (activate Phase 2 now with a free source).** [EEX EU ETS primary auction results](https://www.eex.com/en/market-data/market-data-hub/environmentals/eu-ets-auctions) are free downloads; the [ICAP Allowance Price Explorer](https://icapcarbonaction.com/en/ets-prices) offers downloadable secondary-market series. Removes the last blocker on the carbon-exposure indicator. *Feasibility: one fetcher.*

### P3 — useful, lower urgency or licensed

**2.9 Freight context.** Caustic and PVC competitiveness swings with freight. [Drewry WCI](https://www.drewry.co.uk/supply-chain-advisors/world-container-index-weekly-update/container-shipping1) composite is free weekly (relevant to PVC/solid caustic in containers); liquid-caustic chemical-tanker rates are licensed only (Argus/Clarksons) — note as a model-B candidate, and meanwhile use WCI to annotate import unit-value moves.

**2.10 Employment/investment, NACE 20.13.** Eurostat SBS ([sbs_ovw_act / SBS_SC_OVW](https://ec.europa.eu/eurostat/databrowser/view/SBS_SC_OVW/)) — annual, 18-month lag, but the "jobs at stake" number every MC position paper needs, with provenance. Free API.

**2.11 PRODCOM apparent consumption.** [DS-056120 sold production](https://ec.europa.eu/eurostat/databrowser/view/ds-056120/) for chlorine/NaOH lets you compute apparent consumption (production + imports − exports) and express trade penetration as a share of the EU market — the correct denominator for §1.2. Free, Eurostat API pattern; note PRODCOM confidentiality suppression at product level in some countries.

**2.12 Electricity market structure (PPA availability, exemptions).** Systematic PPA price data (Pexapark) is licensed; the free proxy is the Commission's [Quarterly Reports on European Electricity Markets](https://energy.ec.europa.eu/data-and-analysis/market-analysis_en) — qualitative but citable. Treat as curated reference material, not a series.

## 3. Composite index design critique

As specified (electricity 0.4 / trade 0.3 / utilisation 0.2 / carbon 0.1), the composite would hide more than it reveals, for four reasons:

1. **Incommensurable units.** A ratio, a € flow, percentage points and €/t cannot be blended without normalisation choices (z-scores? min-max over what window?) that will drive the result more than the data does. The spec is silent on this — the hardest part is undefined.
2. **The weights are unfounded and the renormalisation clause is worse.** "Renormalises weights over available components" means the index's composition changes silently as sources come online or go stale — an index that isn't comparable to itself across time. That is precisely the "black-box scoring" the spec forbids.
3. **Double counting and causality confusion.** The trade balance is largely an *outcome* of the electricity and carbon gaps; blending cause and effect overweights the energy story while looking diversified. Utilisation is simultaneously a competitiveness symptom and a demand symptom.
4. **It doesn't map to any MC decision.** No advocacy position, closure review or investment case turns on "the composite fell from 62 to 58." Each lever (power cost, carbon, trade defence) has its own policy channel; a blended number blunts all of them, and a headline number will escape into member communications stripped of caveats.

**If kept, make it defensible:** express every component in the same unit — € per tonne ECU of cost disadvantage vs a named comparator (power gap × intensity + net carbon cost + gas-linked adjustment), which makes "weights" physical intensities rather than opinions; freeze the component set and show "insufficient data" rather than renormalising; publish weight-sensitivity (does the ranking of periods flip under ±50% weight changes?); pin `methodology_version` and backtest against known events (2022 energy crisis, announced closures) before first publication.

**Better alternative:** replace the index with a **cost-gap waterfall** — €/t ECU, EU vs US Gulf and vs China coal-route, decomposed into power, gas, carbon (net of compensation), and freight-to-market — one chart per comparator. Same inputs, no arbitrary weights, and it directly supports the MC's actual conversations with the Commission and with member CFOs.

## 4. Top 5 recommendations

1. **Ingest Euro Chlor's already-public monthly production / operating-rate / caustic-stock series now** ([eurochlor.org/production](https://www.eurochlor.org/production/)) — near-zero effort, unlocks the utilisation gap and makes the trade balance interpretable.
2. **Build the €/t ECU cost-gap waterfall vs US and China** (delivered power × intensity + net carbon) and make it the headline in place of the composite index.
3. **Add the TTF–Henry Hub gas spread** (Eurostat `nrg_pc_203` + World Bank Pink Sheet, both free, both fit the ingestion pattern) — the causal driver behind the electricity ratio.
4. **Stand up the China module** (NBS monthly output, SunSirs caustic spot, Comtrade exports) — the marginal global competitor is currently invisible in the observatory.
5. **Add tonnage-parallel trade/CDI views with dry-basis normalisation and an EEA-supplier tag** — cheap fixes that prevent the two most likely MC-level misreadings (value/volume divergence; "fully dependent on Norway").
