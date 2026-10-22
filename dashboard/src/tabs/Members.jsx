import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { useTheme, GEO_LABEL, FONT } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, SectionHeading, grid2 } from '../components'

// Member-restricted data (Euro Chlor surveys). This tab renders only while
// the member gate is active (/api/mode). Do not screenshot/share outside
// Euro Chlor membership.
const GEO = 'EU27_EFTA_UK'
const GROUP_LABEL = (g) => g.startsWith('ECG_') ? g.slice(4).replace(/_/g, '+') : (GEO_LABEL[g] || g)
const TECH_COLORS = { MEMBRANE: 's2', MERCURY: 's6', DIAPHRAGM_OTHERS: 's3' }
const TECH_LABEL = { MEMBRANE: 'membrane', MERCURY: 'mercury',
                     DIAPHRAGM_OTHERS: 'diaphragm + others' }

const fmtMt = v => `${(v / 1e6).toFixed(2)} Mt`
const axisMt = v => `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} Mt`

function multiLine({ theme, seriesDefs, periods, fmt, axisFmt, height = 260 }) {
  const base = baseOption(theme)
  return <EChart height={height} theme={theme} option={{
    ...base,
    xAxis: { ...base.xAxis, data: periods },
    yAxis: axisFmt ? { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: axisFmt } } : base.yAxis,
    tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : fmt(Number(v)) },
    series: seriesDefs.map(({ name, data, color }) => lineSeries(name, data, color, theme)),
  }} />
}

// horizontal bars of application shares: top 6 + Other, shares of the latest year
function sharesBar(rows, theme, { valueFmt, sharesOnly = false }) {
  const period = rows.length ? rows.map(r => r.period).sort().at(-1) : null
  const latest = rows.filter(r => r.period === period)
    .map(r => ({ name: r.band.replace(/\s*\(.*$/, ''), value: Number(r.value) }))
    .sort((a, b) => b.value - a.value)
  const total = latest.reduce((a, r) => a + r.value, 0)
  const rest = latest.slice(6).reduce((a, r) => a + r.value, 0)
  const items = [...latest.slice(0, 6), ...(rest > 0 ? [{ name: 'Other', value: rest }] : [])].reverse()
  const base = baseOption(theme)
  return {
    period,
    option: {
      ...base,
      grid: { left: 8, right: 44, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false, max: v => v.max * 1.05 },
      yAxis: { type: 'category', data: items.map(s => s.name),
               axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
               axisLabel: { color: theme.inkSecondary, fontSize: 11, width: 150, overflow: 'break' } },
      tooltip: { ...base.tooltip, trigger: 'item',
                 formatter: p => `${p.name}: ${(p.value / total * 100).toFixed(1)} %${sharesOnly ? '' : ` · ${valueFmt(p.value)}`}` },
      series: [{
        type: 'bar', barMaxWidth: 14,
        data: items.map(s => ({ value: s.value, itemStyle: { color: s.name === 'Other' ? theme.axis : theme.series.s1,
                                                             borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: theme.inkSecondary, fontSize: 10.5,
                 formatter: p => `${(p.value / total * 100).toFixed(0)} %` },
      }],
    },
  }
}

function pivot(rows, keyFn) {
  const periods = [...new Set(rows.map(r => r.period))].sort()
  const keys = [...new Set(rows.map(keyFn))]
  const data = {}
  for (const k of keys) {
    const m = new Map(rows.filter(r => keyFn(r) === k).map(r => [r.period, Number(r.value)]))
    data[k] = periods.map(p => m.get(p) ?? null)
  }
  return { periods, keys, data }
}

export default function Members({ fromDate }) {
  const theme = useTheme()
  const [d, setD] = useState(null)
  const [group, setGroup] = useState('')   // one country group shown next to the EU total
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'production.production', geo: GEO, from: fromDate }),
      fetchSeries({ series_id: 'production.capacity' }),
      fetchSeries({ series_id: 'production.utilisation' }),
      fetchSeries({ series_id: 'production.tech_share' }),
      fetchSeries({ series_id: 'consumption.naoh_apparent', geo: GEO }),
      fetchSeries({ series_id: 'production.utilisation', geo: GEO, freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'production.utilisation', geo: 'US', freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'production.utilisation', geo: 'CN', freq: 'A' }),
      fetchIndicators({ indicator_id: 'utilisation_gap' }),
      fetchSeries({ series_id: 'consumption.cl2_applications', geo: GEO }),
      fetchSeries({ series_id: 'consumption.naoh_applications', geo: GEO }),
      fetchSeries({ series_id: 'consumption.h2_applications', geo: GEO }),
      fetchSeries({ series_id: 'efficiency.electricity_intensity', geo: GEO }),
      fetchSeries({ series_id: 'efficiency.primary_energy_intensity', geo: GEO }),
      fetchSeries({ series_id: 'efficiency.h2_utilisation', geo: GEO }),
      fetchSeries({ series_id: 'carbon.footprint', geo: GEO }),
      fetchSeries({ series_id: 'structure.grid_balancing', geo: GEO }),
    ]).then(([cl2, cap, util, tech, naohCons, utilEUm, utilUSm, utilCNa, gaps,
              appsCl2, appsNaoh, appsH2, effEl, effPrim, h2Util, footprint, gridBal]) => {
      setD({
        cl2: cl2.rows.filter(r => r.redistribution_class === 'licensed' && r.period.includes('-')),
        cap: cap.rows.filter(r => r.redistribution_class === 'licensed'),
        util: util.rows.filter(r => r.redistribution_class === 'licensed' && !r.period.includes('-')),
        tech: tech.rows, naohCons: naohCons.rows,
        utilEUm: utilEUm.rows.filter(r => !r.band),
        utilUSm: utilUSm.rows,
        utilCNa: utilCNa.rows,
        gapCN: gaps.rows.filter(r => r.comparator_geo_id === 'CN'),
        apps: { cl2: appsCl2.rows, naoh: appsNaoh.rows, h2: appsH2.rows },
        effEl: effEl.rows, effPrim: effPrim.rows, h2Util: h2Util.rows,
        footprint: footprint.rows, gridBal: gridBal.rows,
      })
    }).catch(e => setError(String(e)))
  }, [fromDate])

  const memo = useMemo(() => {
    if (!d) return null
    const cap = pivot(d.cap.filter(r => r.geo_id === GEO), () => 'Capacity')
    const utilAll = pivot(d.util, r => r.geo_id)
    const groupKeys = utilAll.keys.filter(k => ![GEO, 'US', 'CN'].includes(k)).sort((a, b) => GROUP_LABEL(a).localeCompare(GROUP_LABEL(b)))
    const tech = pivot(d.tech.filter(r => TECH_COLORS[r.band]), r => r.band)
    const naohCons = pivot(d.naohCons, r => r.band)
    return { cap, utilAll, groupKeys, tech, naohCons }
  }, [d])

  // operating rate EU vs US (monthly) with the gap between them shaded; China annual, flat
  const opRate = useMemo(() => {
    if (!d) return null
    const p = pivot([...d.utilEUm.map(r => ({ ...r, k: 'EU' })), ...d.utilUSm.map(r => ({ ...r, k: 'US' }))], r => r.k)
    if (!p.data.EU) return null
    const cnByYear = Object.fromEntries(d.utilCNa.map(r => [r.period, Number(r.value)]))
    const eu = p.data.EU, us = p.data.US || p.periods.map(() => null)
    const lower = eu.map((v, i) => v != null && us[i] != null ? Math.min(v, us[i]) : null)
    const band = eu.map((v, i) => v != null && us[i] != null ? Math.abs(v - us[i]) : null)
    const base = baseOption(theme)
    return {
      ...base,
      xAxis: { ...base.xAxis, data: p.periods, boundaryGap: false },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: v => `${v} %` } },
      tooltip: {
        ...base.tooltip,
        formatter: ps => {
          const i = ps[0]?.dataIndex
          const rows = ps.filter(x => !x.seriesName.startsWith('_') && x.value != null)
            .map(x => `${x.marker} ${x.seriesName}: <b>${Number(x.value).toFixed(1)} %</b>`)
          if (eu[i] != null && us[i] != null) rows.push(`<span style="color:${theme.inkMuted}">EU − US: <b>${(eu[i] - us[i]).toFixed(1)} pp</b></span>`)
          return [`<b>${ps[0]?.axisValue}</b>`, ...rows].join('<br/>')
        },
      },
      series: [
        { name: '_base', type: 'line', stack: 'gap', data: lower, symbol: 'none', silent: true,
          lineStyle: { width: 0 }, tooltip: { show: false } },
        { name: '_gap', type: 'line', stack: 'gap', data: band, symbol: 'none', silent: true,
          lineStyle: { width: 0 }, tooltip: { show: false }, areaStyle: { color: theme.series.s6, opacity: 0.12 } },
        lineSeries('Euro Chlor', eu, theme.series.s1, theme),
        lineSeries('US', us, theme.series.s2, theme),
        lineSeries('China (annual)', p.periods.map(per => cnByYear[per.slice(0, 4)] ?? null), theme.series.s3, theme),
      ],
    }
  }, [d, theme])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!d || !memo) return <EmptyState>Loading…</EmptyState>
  if (!d.cl2.length) {
    return <EmptyState>No member data ingested yet — drop the survey workbooks into
      data/eurochlor_drop/ and run the eurochlor_members agent.</EmptyState>
  }

  const src = d.cl2.slice(-1)

  return (
    <>
      <div style={{ fontSize: 12, color: theme.inkSecondary, marginBottom: 16,
                    padding: '10px 14px', borderRadius: 10, background: theme.accentSoft }}>
        🔒 Member-restricted data (Euro Chlor surveys) — served only behind the member gate.
        Blank survey cells are competition-rule suppressions and are never shown as zero.
        Monthly chlorine and caustic soda production is on the Market tab.
      </div>

      <SectionHeading title="Capacity and operating rates" />
      <Card title="Operating rate — EU vs US vs China"
        subtitle="EU and US monthly (Euro Chlor / Chlorine Institute), %; the shaded band is the gap between them. China plotted flat per year — CCAIA publishes annual figures only."
        sourceRows={[...d.utilEUm.slice(-1), ...d.utilUSm.slice(-1), ...d.utilCNa.slice(-1)]}
        right={<Legend items={[
          { label: 'Euro Chlor', color: theme.series.s1 },
          { label: 'US', color: theme.series.s2 },
          { label: 'China (annual)', color: theme.series.s3 },
        ]} />}>
        {opRate ? <EChart option={opRate} height={280} theme={theme} /> : <EmptyState>No monthly operating rates.</EmptyState>}
        {d.gapCN.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: theme.inkMuted }}>EU − China, annual:</span>
            {[...d.gapCN].sort((a, b) => a.period.localeCompare(b.period)).map(r => (
              <span key={r.period} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
                border: `1px solid ${theme.border}`, color: Number(r.value) < 0 ? theme.bad : theme.good,
                fontVariantNumeric: 'tabular-nums' }}>
                {r.period}: {Number(r.value).toFixed(1)} pp
              </span>
            ))}
          </div>
        )}
      </Card>

      <div style={grid2}>
        <Card title="Name-plate capacity — EU total" sourceRows={src}
          subtitle="Annual survey, Mt chlorine per year. The denominator behind operating rates.">
          {multiLine({ theme, periods: memo.cap.periods, fmt: v => `${fmtMt(v)}/yr`, axisFmt: axisMt,
            seriesDefs: [{ name: 'Capacity', data: memo.cap.data.Capacity, color: theme.series.s1 }] })}
        </Card>

        <Card title="Utilisation rate — by country group" sourceRows={src}
          subtitle="Annual survey, %. All Euro Chlor, optionally against one anonymised country group (groupings change over time; gaps = competition-rule suppressions).">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <Legend items={[{ label: 'All Euro Chlor', color: theme.series.s1 },
                            ...(group ? [{ label: GROUP_LABEL(group), color: theme.series.s8 }] : [])]} />
            <select value={group} onChange={e => setGroup(e.target.value)} style={{
              marginLeft: 'auto', fontFamily: FONT, fontSize: 12, padding: '4px 8px', borderRadius: 6,
              border: `1px solid ${theme.border}`, background: theme.surface, color: theme.ink }}>
              <option value="">Compare with a country group…</option>
              {memo.groupKeys.map(g => <option key={g} value={g}>{GROUP_LABEL(g)}</option>)}
            </select>
          </div>
          {multiLine({ theme, periods: memo.utilAll.periods, fmt: v => `${v.toFixed(1)} %`, height: 230,
            seriesDefs: [
              { name: 'All Euro Chlor', data: memo.utilAll.data[GEO], color: theme.series.s1 },
              ...(group ? [{ name: GROUP_LABEL(group), data: memo.utilAll.data[group], color: theme.series.s8 }] : []),
            ] })}
        </Card>

        <Card title="Production share by electrolysis technology" sourceRows={src}
          subtitle="Annual survey, %. 'Diaphragm + others' (fused salt, MgCl2, HCl, mercury for alcoholates) is 100% − membrane − mercury: exact to 2013, estimated residual after (components suppressed per competition rules)."
>
          <Legend items={Object.entries(TECH_COLORS)
            .filter(([t]) => memo.tech.keys.includes(t))
            .map(([t, s]) => ({ label: TECH_LABEL[t], color: theme.series[s] }))} />
          {multiLine({ theme, periods: memo.tech.periods, fmt: v => `${v.toFixed(1)} %`,
            seriesDefs: memo.tech.keys.map(t => (
              { name: TECH_LABEL[t], data: memo.tech.data[t], color: theme.series[TECH_COLORS[t] || 's8'] })) })}
        </Card>

        <Card title="Caustic soda — sales vs captive use" sourceRows={src}
          subtitle="Annual survey, all Euro Chlor countries, Mt. Captive share signals integration; merchant sales face the import competition shown on the Trade tab."
          right={<Legend items={[
            { label: 'Merchant sales', color: theme.series.s1 },
            { label: 'Captive use', color: theme.series.s5 },
          ]} />}>
          {multiLine({ theme, periods: memo.naohCons.periods, fmt: fmtMt, axisFmt: axisMt,
            seriesDefs: [
              { name: 'Merchant sales', data: memo.naohCons.data.SALES, color: theme.series.s1 },
              { name: 'Captive use', data: memo.naohCons.data.CAPTIVE, color: theme.series.s5 },
            ] })}
        </Card>
      </div>

      <SectionHeading title="Where the products go" />
      <Card title="Applications — Industry Review 2025 data collection" sourceRows={d.apps.cl2.slice(-1)}
        subtitle="Share of use per product, latest year. Chlorine and caustic soda in kt (hover for volumes); the hydrogen sheet specifies no unit, so shares only. Categories beyond the top 6 fold into 'Other'.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
          {[
            { key: 'cl2', title: 'Chlorine', rows: d.apps.cl2, fmt: v => `${(v / 1e3).toFixed(0)} kt`, sharesOnly: false },
            { key: 'naoh', title: 'Caustic soda', rows: d.apps.naoh, fmt: v => `${(v / 1e3).toFixed(0)} kt`, sharesOnly: false },
            { key: 'h2', title: 'Hydrogen', rows: d.apps.h2, fmt: v => v, sharesOnly: true },
          ].map(({ key, title, rows, fmt, sharesOnly }) => {
            if (!rows.length) return null
            const bars = sharesBar(rows, theme, { valueFmt: fmt, sharesOnly })
            return (
              <div key={key}>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: theme.ink, marginBottom: 4 }}>
                  {title} <span style={{ color: theme.inkMuted, fontWeight: 500 }}>{bars.period}</span>
                </div>
                <EChart height={230} theme={theme} option={bars.option} />
              </div>
            )
          })}
        </div>
      </Card>

      <details style={{ marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer', listStyle: 'revert', fontSize: 15, fontWeight: 700,
                          color: theme.ink, padding: '10px 0' }}>
          Sustainability profile <span style={{ fontWeight: 500, fontSize: 12.5, color: theme.inkSecondary }}>
          — energy intensity, GHG footprint, hydrogen use, grid balancing (Industry Review)</span>
        </summary>
        <div style={{ ...grid2, marginTop: 10 }}>
          <Card title="Energy intensity per tonne Cl2"
            subtitle="Industry Review. Final electricity vs primary fuel energy (incl. conversion losses), kWh/t — the efficiency lever behind the power-cost story."
            sourceRows={d.effEl.slice(-1)}>
            <Legend items={[
              { label: 'Electricity (final)', color: theme.series.s1 },
              { label: 'Primary energy', color: theme.series.s5 },
            ]} />
            {(() => {
              const p = pivot([...d.effEl.map(r => ({ ...r, k: 'el' })),
                               ...d.effPrim.map(r => ({ ...r, k: 'prim' }))], r => r.k)
              return multiLine({ theme, periods: p.periods, fmt: v => `${v.toFixed(0)} kWh/t`, height: 220,
                seriesDefs: [
                  { name: 'Electricity (final)', data: p.data.el, color: theme.series.s1 },
                  { name: 'Primary energy', data: p.data.prim, color: theme.series.s5 },
                ] })
            })()}
          </Card>

          <Card title="GHG footprint per tonne Cl2"
            subtitle="Industry Review, tCO2eq/t Cl2, from 2020 — the decarbonisation trajectory."
            sourceRows={d.footprint.slice(-1)}>
            {(() => {
              const p = pivot(d.footprint.map(r => ({ ...r, k: 'f' })), r => r.k)
              return multiLine({ theme, periods: p.periods, fmt: v => `${v.toFixed(2)} tCO2eq/t`, height: 220,
                seriesDefs: [{ name: 'Footprint', data: p.data.f, color: theme.series.s6 }] })
            })()}
          </Card>

          <Card title="Hydrogen utilisation rate"
            subtitle="Industry Review. Share of co-produced hydrogen valorised — the remainder is vented (see hydrogen applications above)."
            sourceRows={d.h2Util.slice(-1)}>
            {(() => {
              const p = pivot(d.h2Util.map(r => ({ ...r, k: 'h' })), r => r.k)
              return multiLine({ theme, periods: p.periods, fmt: v => `${v.toFixed(1)} %`, height: 220,
                seriesDefs: [{ name: 'Utilised', data: p.data.h, color: theme.series.s2 }] })
            })()}
          </Card>

          <Card title="Capacity offered to grid balancing"
            subtitle="Industry Review. Share of chlor-alkali capacity offered as balancing reserve — flexibility monetisation in the power market."
            sourceRows={d.gridBal.slice(-1)}>
            <Legend items={[
              { label: 'total', color: theme.series.s1 }, { label: 'FCR', color: theme.series.s2 },
              { label: 'aFRR', color: theme.series.s3 }, { label: 'mFRR', color: theme.series.s5 },
            ]} />
            {(() => {
              const p = pivot(d.gridBal, r => r.band)
              return multiLine({ theme, periods: p.periods, fmt: v => `${v.toFixed(1)} %`, height: 220,
                seriesDefs: [
                  { name: 'total', data: p.data.TOTAL, color: theme.series.s1 },
                  { name: 'FCR', data: p.data.FCR, color: theme.series.s2 },
                  { name: 'aFRR', data: p.data.AFRR, color: theme.series.s3 },
                  { name: 'mFRR', data: p.data.MFRR, color: theme.series.s5 },
                ] })
            })()}
          </Card>
        </div>
      </details>
    </>
  )
}
