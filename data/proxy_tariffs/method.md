# Industrial electricity prices for CN, IN, GULF: method notes

Compiled 2026-10-22 for the Euro Chlor Competitiveness Observatory cost-gap series.
Target concept, matching the EU side (Eurostat nrg_pc_205, MWH_GE150000, excl. VAT, incl. non-recoverable taxes, levies and network charges): **the delivered price a large high-voltage baseload industrial user pays, i.e. energy + network + levies, excluding VAT.**

## Files

- `tariffs.csv`: the headline series. One row per (geo_id, period). This is the file the pipeline should load.
- `tariffs_alternatives.csv`: same schema. Holds alternative rows for the same geo and period: other provinces or states, other tariff options, other voltages. Use them for sensitivity checks; don't load them alongside `tariffs.csv`, or you get two values for one period.
- `china_rows.csv`, `india_rows.csv`, `gulf_rows.csv`, `gulf_alt_rows.csv`: the per-region working files these two files were assembled from.
- `dl*/`: raw downloads, kept for audit.
- `scripts*/`: the scripts that compute the values.

Periods are calendar years unless a note says otherwise. No value is interpolated. A gap means no verified source.

## CN: Shandong, large industry (大工业 / 工商业两部制), 35-110 kV

**Why Shandong.** It is China's largest chlor-alkali province. It has one consistent published series across the 2021 reform, and it is connected to the State Grid (no isolated captive system).

**What each row contains.** Energy rate (电度电价, including government funds) + demand charge (基本电价) converted to CNY/kWh, then VAT removed. Unit: CNY/MWh, excl. VAT. The pipeline converts CNY to EUR via the ECB.

- **Demand charge.** CNY/kW·month × 12 / 8,000 h. This assumes a flat baseload (maximum demand = average load, about 91% load factor on 8,760 h).
  - 38 CNY/kW·month until May-2023 = 57.0 CNY/MWh.
  - 35.2 from Jun-2023 = 52.8 CNY/MWh.
  - 36.0 from Aug-2026, when the voltage class becomes "35 kV".
  - The alternative transformer-capacity option (28, later 22, CNY/kVA·month) was not used.
- **Government funds are included in the energy rate.** Pre-reform: the catalogue table note lists the water-project fund 0.196875 fen, the reservoir-resettlement fund 0.62 fen and the renewable surcharge 1.9 fen. Post-reform: 2.716875 fen.
- **VAT.** Chinese tariffs are quoted VAT-inclusive. VAT was removed at 17% (2015-17), 16% (2018) and 13% (2019+).
  - The 2018-19 VAT cuts were passed on only to single-part industry and commerce. The VAT-inclusive large-industry rate held, so the ex-VAT value *rises* in 2018-19.
  - For post-reform notices "含税" is inferred rather than printed. The 2021 transmission and distribution (T&D) table states 含增值税.
- **2015-Nov 2021: provincial catalogue tariff** (鲁价格一发 notices). Before 2023 the time-of-use (TOU) blocks were symmetric (peak, flat and valley, each 8 h, around the flat rate). A flat load therefore pays the flat rate, which I checked on the 2019-20 table: (0.8888 + 0.6022 + 0.3157)/3 = 0.6022.
- **Dec-2021 onward: State Grid monthly agency-purchase (代理购电) notices.** Each month's "电度用电价格" is the agency purchase price + capacity compensation + losses + system operation + T&D + funds.
  - Annual value = the mean of the 12 monthly totals.
  - 2021 blends 11 catalogue months with December's agency price.
  - 2026 covers Jan-Oct only.
  - Post-2023 TOU blocks are asymmetric. A spot check (Mar-2025) shows a flat 24 h load pays about 0.9% more than the flat-period level used.

**Values** (CNY/MWh excl. VAT):

| 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (Jan-Oct) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 589.2 | 589.2 | 577.8 | 571.2 | 583.4 | 583.4 | 576.6 | 644.8 | 643.8 | 633.4 | 618.3 | 590.5 |

At ECB annual CNY rates this is roughly 75-90 EUR/MWh (about 80-90 USD/MWh). I checked 0.6022 and the 2025-03 total of 0.67486875 + 35.2 demand charge myself against downloaded copies of the Jining government page and the Yantai government page.

**Sources and gaps.**
- Post-reform monthly values were read from images of State Grid Shandong notices mirrored by energydc.cn. The State Grid and Shandong DRC sites refused or timed out. The Yantai government page independently matches Mar-2025.
- 2015 covers the tariff from 20-Apr-2015 only.
- 2017 is a half-year blend: H1 at 0.6324, H2 at 0.6056 after a 2.6-fen cut (the 1-Jul-2017 effective date comes from secondary sources only). Applying the H2 rate to the whole year would give 566.3.
- 2019 applies the 1-Jul-2019 table to the whole year.

**Main weaknesses vs. Eurostat. Read this as a grid-supply reference price, not what a typical Chinese chlor-alkali plant pays.**
1. **Direct trading.** Before 2021, large users largely bought through direct trading (直接交易) at negotiated discounts to the catalogue. After 2021 they buy in the market, so the agency price is only a proxy for their contract price.
   - Energy-intensive (高耗能) users left on agency purchase pay 1.5× the agency purchase price. This is not applied.
2. **Captive coal power (自备电厂).** Much of China's chlor-alkali capacity (Xinjiang, Inner Mongolia, also Shandong groups) runs on it at well below grid prices, so the Shandong grid price is likely an **upper bound** for national average chlor-alkali power cost.
3. **Penalty pricing not included.** Differential and tiered penalty pricing (差别电价 / 阶梯电价) for plants above the caustic-soda energy benchmark raises prices for laggards; no figures were found.
   - The chlor-alkali preferential rates in Shandong ended in 2015-16 (electrolytic caustic −1 fen ended 20-Apr-2015; ion-membrane preference ended 1-Jan-2016).
4. The 2020 COVID 5% cut excluded energy-intensive users, so it is not applied.
5. **2026 renewable-settlement charge.** A new charge of about 3-10 fen/kWh from 2026 offsets part of the 2026 decline. Coverage of this charge in the agency notices was not fully verified.

**Not covered:** Inner Mongolia, Xinjiang and Jiangsu series; CEC/NEA national average sales prices; China Chlor-Alkali Industry Association cost data.

**Validation.** IEA (Mid-Year Update 2025) puts the EU energy-intensive price, after ETS compensation, about 50% above China (Inner Mongolia proxy) in 2025 and about 20% above in 2019. Inner Mongolia's grid price is lower than Shandong's, so an EU/Shandong ratio below IEA's EU/China ratio would be expected.

**Confidence: medium.** The tariff arithmetic is high confidence; representativeness for chlor-alkali is low to medium.

## IN: Gujarat HTP-I (headline), Tamil Nadu HT I-A (alternative)

**Period convention, which the pipeline needs to know.** For IN, `period` is the Indian fiscal year start year: "2023" = FY2023-24 (Apr-2023 to Mar-2024). `reference_period` states this on every row. Using the series as calendar years introduces a 3-month lag. Converting would mean 0.25 × FY(y−1) + 0.75 × FY(y), which is not done here so as to keep gaps visible.

**Why Gujarat.** It is the largest caustic-soda state. The four Gujarat Urja Vikas Nigam Ltd (GUVNL) distribution companies charge a uniform tariff, and GERC orders and FPPPA circulars give a full component trail.

**Representative consumer, a computed bill, not a published average:**
- 50,000 kVA contract and billing demand, power factor 0.90 (the CEA convention), so a maximum demand of 45 MW.
- 90% load factor: 29.565 GWh/month, about 355 GWh/yr, inside the ≥150 GWh band.
- Flat 24 h load, supply at 66 kV.

**Gujarat bill components** (Rs/kWh, FY2023-24 example):

| Component | Rs/kWh | Basis |
|---|---|---|
| Demand charge | 0.794 | Slabs 150/260/475 Rs/kVA·month |
| Energy charge | 4.268 | 4.30 less 0.75% EHV rebate |
| Time-of-use (TOU) | 0.283 | 85 paise on 8 peak hours |
| Night concession | −0.143 | 43 paise on 22-06 h energy |
| Fuel and power purchase price adjustment (FPPPA) | 3.163 | Simple mean of monthly billed rates |
| Electricity duty | 1.255 | 15% on all consumption charges, including FPPPA |
| **Total** | **9.62** | **= 9,619 INR/MWh** |

- Tariffs come from CEA "Electricity Tariff & Duty and Average Rates" (Mar-2016/17/18 editions) and GERC tariff schedules or orders for later years. FPPPA comes from GUVNL, distribution-company and GERC circulars. All were read as Wayback `id_` captures, because cea.nic.in, gercin.org and guvnl.com refuse direct access.
- The duty base including FPPPA follows the Gujarat Electricity Duty Act definition of "consumption charges". Duty on demand + energy + TOU only would be about 2.5-5% lower (FY23-24: 9,145).

**Values** (INR/MWh, excl. VAT/GST, which does not apply to electricity):

| FY start | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|---|---|---|---|---|---|
| Gujarat | 8,128 | 8,020 | 8,129 | gap | 8,352 | 8,144 | 8,244 | 8,996 | 9,619 | 9,167 |
| Tamil Nadu (alternative) | n/a | n/a | n/a | 7,525 | 7,525 | 7,525 | 7,525 | 8,096 | 8,694 | n/a |

Approximate USD/MWh: Gujarat about 116 (FY23-24) and about 108 (FY24-25).

**Gaps and inferred months:**
- FY2018-19 is blank because the Jul-Dec 2018 FPPPA is undocumented, with conflicting news figures.
- FY2025-26 onward is blank because the FPPPA is only partly known and tariff terms changed (1.5% EHV rebate, 60 paise solar-hour discount).
- Some FPPPA months are inferred from "continue till further communication" circulars or news items: Oct-Dec 2017, Jan-Mar 2020, Jul-Dec 2023, and parts of FY24-25. They are flagged in each row's notes.
- FY2024-25 duty is assumed to stay at 15%.

**Tamil Nadu:**
- Demand + energy + time-of-day uplift (energy ×1.0354 from Aug-2017, ×1.0688 from Sep-2022 for a flat load) + 5% electricity tax.
- Tamil Nadu Generation and Distribution Corporation (TANGEDCO) applied no fuel surcharge in these years according to the CEA books; this was not independently verified.
- Before FY2018-19 and from FY2024-25 it is omitted (the time-of-day rule is undocumented before Aug-2017; there is no primary source for the July-2024 revision).

**Note on CEA "Average rates".** CEA Table 7 average rates for large industry are demand + energy only. They exclude FPPPA, TOU and rebates; I reproduced Gujarat's 549 paise/kWh exactly from these components. CEA understates the Gujarat delivered price by roughly 30%, because the FPPPA is about 2-3 Rs/kWh, so CEA is not used directly.

**Weaknesses vs. Eurostat:**
1. **Captive coal power.** Large Indian chlor-alkali producers rely heavily on it. JMK Research (Aug-2025), *Green Power Procurement in the Bulk Chemical sector*, says coal is "predominantly used (especially by larger players)" and cites DCM Shriram's 383 MW of captive coal capacity. This grid tariff is therefore an **upper bound** on what large producers actually pay.
2. **Open-access purchase** (paying the cross-subsidy surcharge, CEA lists 1.50 Rs/kWh for Gujarat HT in FY22-23, plus an additional surcharge) is another cheaper route, not modelled.
3. **Cross-subsidy loading.** Indian HT industrial tariffs carry cross-subsidies to agriculture and households, which is part of why they are high relative to cost.
4. **Exclusions.** The power-factor rebate (up to about 2.5% of energy at PF > 0.95) and FPPPA arrear recoveries are excluded.

**Confidence: medium.** The tariff arithmetic is high confidence. The FPPPA months, the duty base and the period convention are medium. Representativeness for chlor-alkali is low to medium because of captive power.



## GULF (Saudi Arabia headline; UAE alternative)

**Why Saudi Arabia is the headline.** Most Gulf chlor-alkali capacity is in Saudi Arabia, and SEC publishes one nationwide industrial tariff. Abu Dhabi's large-industry time-of-use (TOU) tariff works out at about 78 USD/MWh, against 48 USD/MWh in Saudi Arabia. That gap is real but less relevant, because large Abu Dhabi energy-intensive plants (for example aluminium) mostly use captive or bilateral supply. The Abu Dhabi figure is in the alternatives file only.

**Method (Saudi Arabia).** The SEC "Industrial" category is one flat energy rate per kWh for all consumption. It has no capacity or demand charge and no separate network charge or levy, so it is directly an all-in delivered price. Tariffs are quoted excluding VAT. VAT was 5% from 2018 and is higher now; either way it is recoverable for businesses and excluded. The figures are converted at the SAR peg of 3.75 per USD. No load-factor assumption is needed.

| Period | Halalas/kWh | USD/MWh | Evidence |
|---|---|---|---|
| 2015 | n/a | gap | The 2010-2015 schedule was seasonal with peak pricing (up to 26 halalas). No official copy could be opened. |
| 2016 | 18 | 48.00 | **Inferred.** The SEC tariff history lists changes on 11-Jan-2016 and then 1-Jan-2018, nothing in between. SPA confirms 18 in Dec-2017. |
| 2017-2024 | 18 | 48.00 | SPA/ECRA 12-Dec-2017: industrial "all consumption 18 halalas", unchanged in 2018. SEC 2025 statements record no change until May-2025. |
| 2025 | 18, then 20 from 28-May | 51.19 | Day-weighted. The 2-halala add-on applies to customers not eligible for the Intensive Consumption Tariff (SEC Q3-2025 statements). |
| 2026 | 20 | 53.33 | SEC Consumption Tariffs page, read Oct-2026. |

**Lead caveat: the Heavy (Intensive) Consumption Tariff from 2023.** Council of Ministers resolution 111 (Sep-2021) created this tariff, and it has applied since 1-Jan-2023. It has two categories:
- **First category** (electricity at least 20% of operating cost excluding raw materials): 12 halalas/kWh if transmission-connected, 18 if distribution-connected.
- **Second category** (10-19.9%): 18 and 24 halalas/kWh.

Eligibility also requires an annual load factor of at least 80% and an activity on a list set by a Ministry of Energy committee. A membrane chlor-alkali plant almost certainly passes the cost-share and load-factor tests. **I could not verify whether chlor-alkali or chemicals are on the eligible-activity list.** If they are, the relevant Saudi price from 2023 is **32 USD/MWh, not 48-53**: about 16-21 USD/MWh lower, or roughly 45-55 USD per tonne ECU at 2.629 MWh/t. These rows are in `tariffs_alternatives.csv`. The headline keeps the standard tariff because it is the published rate that applies to every industrial customer. **Recommendation:** confirm eligibility with a Saudi member or SERA, and switch the 2023+ headline if chlor-alkali qualifies.

**Other Gulf caveats.**
- Contract and feedstock arrangements in integrated petrochemical complexes (Jubail/Yanbu, Marafiq as utility) are not public.
- Marafiq publishes its own power tariff for Jubail/Yanbu industrial cities. It could not be opened (connection refused), so it is not used.
- UAE: Abu Dhabi industrial >1 MW, effective 1-Jan-2017, is 27 fils/kWh, or 36.6 fils/kWh in summer peak hours. At flat baseload that averages 28.6 fils/kWh, about 77.9 USD/MWh at the AED peg of 3.6725.
  - The peak window (10:00-22:00, June-September) and the persistence of these rates to 2025 come from search-engine extracts of addc.ae pages, which block automated access. Only the 2017 row is reported.
  - DEWA (Dubai) could not be opened either.

**Weaknesses vs. Eurostat.**
- This is a regulated tariff schedule, not an observed average price paid; Eurostat reports observed prices.
- Gulf tariffs sit well below the cost of supply, the gap being covered by state fuel pricing and the SEC balancing account. Treat them as administered prices.

**Confidence.**
- Standard tariff level 2017-2026: **high**.
- 2016: **medium** (inferred).
- Whether the standard tariff is the price a chlor-alkali plant actually pays from 2023: **low** (heavy-tariff eligibility unknown).
- UAE: **low**.

## Cross-country validation

- **IEA Energy Prices database** (paid, quarterly, end-user industrial prices incl. taxes): the natural validator. Not used here because it is paywalled. The IEA chart page "Estimated final electricity price for large industrial customers in energy-intensive industries" is behind a bot check, so its values could not be read.
- **IEA Electricity Mid-Year Update 2025** (free PDF, https://iea.blob.core.windows.net/assets/cc64f0aa-30e4-4497-9cca-1ffae2c55fe5/ElectricityMid-YearUpdate2025.pdf, p. 28) is a usable qualitative anchor:
  - In 2025, EU prices for energy-intensive industries (>150 GWh/yr, Eurostat-based, *after* ETS indirect-cost compensation) are "roughly twice" the US level and about 50% above China.
  - In 2019 the EU premium was about 50% over the US and 20% over China.
  - IEA proxies the US with Texas and China with **Inner Mongolia**, a major chlor-alkali province, so it is a direct sanity check for the CN series.
  - Note that the IEA EU figure *subtracts* ETS compensation, while Eurostat nrg_pc_205 does not. The observatory's EU-China ratio should therefore come out somewhat above IEA's 1.5x.

## Summary of confidence

**Directional bias.** All three comparator series are published grid or regulated tariffs, and each probably *overstates* what a large chlor-alkali plant actually pays: in China because of captive coal and direct trading, in India because of captive coal and open access, and in Saudi Arabia because the 12-halala Heavy Consumption Tariff may apply from 2023. The computed EU cost gap is therefore best read as a **lower bound** on the EU disadvantage.


| Region | Headline series | Coverage | Confidence | Main risk |
|---|---|---|---|---|
| CN | Shandong 35-110 kV grid price | 2015-2026 (2026 Jan-Oct) | Medium | Captive power and direct trading mean actual chlor-alkali cost is lower |
| IN | Gujarat HTP-I computed bill | FY2015-FY2024, FY2018 gap | Medium | Captive coal power; fiscal-year periods; inferred FPPPA months |
| GULF | Saudi SEC standard industrial tariff | 2016-2026 | High for the tariff, low for applicability from 2023 | Heavy Consumption Tariff (12 halalas = 32 USD/MWh) may apply to chlor-alkali |


## Adaptations when loading (2026-10-22)

- **India, fiscal → calendar half-years.** The Observatory compares prices per
  calendar half-year. Indian tariffs run by fiscal year (Apr–Mar), so each
  fiscal-year bill was mapped: Jul–Dec Y = FY Y-(Y+1); Jan–Jun Y = half FY
  (Y-1)-Y (Jan–Mar) + half FY Y-(Y+1) (Apr–Jun). Half-years that would need the
  missing FY2018-19 are left out (2018, 2019-S1); no extrapolation. Each row's
  reference_period and notes state the fiscal years used.
- **Gulf, two lines.** GULF = Saudi standard industrial tariff (all years).
  GULF_EI = Saudi Heavy Consumption Tariff for eligible energy-intensive users
  (12 halalas/kWh, from 2023). Whether chlor-alkali is on the eligible list could
  not be confirmed, so both are shown and the truth lies between them.
- **Currency.** CNY and INR rows are converted to EUR with the mean of the ECB
  monthly rates over the row's period (year or half-year).
- Alternatives not loaded (Tamil Nadu, Abu Dhabi) are kept in reference/.
