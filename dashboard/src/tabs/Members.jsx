import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { useTheme, GEO_SLOT, GEO_LABEL } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend } from '../components'

// Member-restricted data (Euro Chlor surveys). This tab renders only while
// the member gate is active (/api/mode). Do not screenshot/share outside
// Euro Chlor membership.
const GEO = 'EU27_EFTA_UK'
const GROUP_LABEL = (g) => g.startsWith('ECG_') ? g.slice(4).replace(/_/g, '+') : (GEO_LABEL[g] || g)
const TECH_COLORS = { MEMBRANE: 's2', MERCURY: 's6', DIAPHRAGM: 's3', FUSED: 's5', OTHER: 's8' }

function multiLine({ theme, seriesDefs, periods, fmt, height = 260, stacked = false }) {
  const base = baseOption(theme)
  return <EChart height={height} theme={theme} option={{
    ...base,
    xAxis: { ...base.xAxis, data: periods, boundaryGap: stacked ? false : undefined },
    tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : fmt(Number(v)) },
    series: seriesDefs.map(({ name, data, color }) => stacked
      ? { name, type: 'line', stack: 'a', data, symbol: 'none', lineStyle: { width: 0 },
          areaStyle: { color, opacity: 0.85 }, itemStyle: { color }, emphasis: { focus: 'series' } }
      : lineSeries(name, data, color, theme)),
  }} />
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
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'production.production', geo: GEO, from: fromDate }),
      fetchSeries({ series_id: 'production.caustic_production', geo: GEO, from: fromDate }),
      fetchSeries({ series_id: 'production.caustic_stocks', geo: GEO, from: fromDate }),
      fetchSeries({ series_id: 'production.capacity' }),
      fetchSeries({ series_id: 'production.utilisation' }),
      fetchSeries({ series_id: 'production.tech_share' }),
      fetchSeries({ series_id: 'consumption.cl2_by_use' }),
      fetchSeries({ series_id: 'consumption.naoh_apparent', geo: GEO }),
      fetchSeries({ series_id: 'production.utilisation', geo: GEO, freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'production.utilisation', geo: 'US', freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'production.utilisation', geo: 'CN', freq: 'A' }),
      fetchIndicators({ indicator_id: 'utilisation_gap' }),
    ]).then(([cl2, naoh, stocks, cap, util, tech, uses, naohCons, utilEUm, utilUSm, utilCNa, gaps]) => {
      setD({
        cl2: cl2.rows.filter(r => r.redistribution_class === 'licensed' && r.period.includes('-')),
        naoh: naoh.rows.filter(r => r.period.includes('-')),
        stocks: stocks.rows,
        cap: cap.rows.filter(r => r.redistribution_class === 'licensed'),
        util: util.rows.filter(r => r.redistribution_class === 'licensed' && !r.period.includes('-')),
        tech: tech.rows, uses: uses.rows, naohCons: naohCons.rows,
        utilEUm: utilEUm.rows.filter(r => !r.band),
        utilUSm: utilUSm.rows,
        utilCNa: utilCNa.rows,
        gapUS: gaps.rows.filter(r => r.comparator_geo_id === 'US' &&
                                     (!fromDate || r.period_start >= fromDate)),
        gapCN: gaps.rows.filter(r => r.comparator_geo_id === 'CN'),
      })
    }).catch(e => setError(String(e)))
  }, [fromDate])

  const memo = useMemo(() => {
    if (!d) return null
    const prod = pivot([...d.cl2.map(r => ({ ...r, k: 'Cl2' })), ...d.naoh.map(r => ({ ...r, k: 'NaOH' }))], r => r.k)
    const stocks = pivot(d.stocks.filter(r => ['TOTAL', 'LIQUIDS', 'SOLIDS'].includes(r.band)), r => r.band)
    const capUtil = (() => {
      const capEU = d.cap.filter(r => r.geo_id === GEO)
      const prodAnnual = pivot(capEU.map(r => ({ ...r, k: 'Capacity' })), r => r.k)
      return prodAnnual
    })()
    const utilGroups = pivot(d.util.filter(r => r.geo_id !== GEO), r => r.geo_id)
    const utilEU = pivot(d.util.filter(r => r.geo_id === GEO), () => 'TOTAL')
    const tech = pivot(d.tech, r => r.band)
    const latestUseYear = Math.max(...d.uses.map(r => Number(r.period)), 0)
    const uses = d.uses
      .filter(r => r.period === String(latestUseYear) && r.band !== 'TOTAL' && !/^\d\.\d/.test(r.band))
      .sort((a, b) => Number(a.value) - Number(b.value))
    const naohCons = pivot(d.naohCons, r => r.band)
    return { prod, stocks, capUtil, utilGroups, utilEU, tech, uses, latestUseYear, naohCons }
  }, [d])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!d || !memo) return <EmptyState>Loading…</EmptyState>
  if (!d.cl2.length) {
    return <EmptyState>No member data ingested yet — drop the survey workbooks into
      data/eurochlor_drop/ and run the eurochlor_members agent.</EmptyState>
  }

  const src = d.cl2.slice(-1)
  const fmtKt = v => `${(v / 1e3).toFixed(0)} kt`

  return (
    <>
      <div style={{ fontSize: 12, color: theme.inkSecondary, marginBottom: 16,
                    padding: '10px 14px', borderRadius: 10,
                    background: theme.accentSoft }}>
        🔒 Member-restricted data (Euro Chlor surveys) — served only behind the member gate.
        Blank survey cells are competition-rule suppressions and are never shown as zero.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card title="Monthly production — chlorine & caustic soda" sourceRows={src}
          subtitle="Member survey monthly series (chlorine from 2000, caustic from 2019 — caustic production is not published publicly)."
          right={<Legend items={[
            { label: 'Chlorine', color: theme.series.s1 },
            { label: 'Caustic soda', color: theme.series.s2 },
          ]} />}>
          {multiLine({ theme, periods: memo.prod.periods, fmt: fmtKt,
            seriesDefs: [
              { name: 'Chlorine', data: memo.prod.data.Cl2, color: theme.series.s1 },
              { name: 'Caustic soda', data: memo.prod.data.NaOH, color: theme.series.s2 },
            ] })}
        </Card>

        <Card title="Caustic soda stocks — by form" sourceRows={src}
          subtitle="Member survey; total plus liquids/solids split."
          right={<Legend items={['TOTAL', 'LIQUIDS', 'SOLIDS'].map((b, i) => (
            { label: b.toLowerCase(), color: theme.series[['s1', 's2', 's3'][i]] }))} />}>
          {multiLine({ theme, periods: memo.stocks.periods, fmt: fmtKt,
            seriesDefs: ['TOTAL', 'LIQUIDS', 'SOLIDS'].map((b, i) => (
              { name: b.toLowerCase(), data: memo.stocks.data[b], color: theme.series[['s1', 's2', 's3'][i]] })) })}
        </Card>

        <Card title="Name-plate capacity — EU total" sourceRows={src}
          subtitle="Annual survey, kt/yr scaled to tonnes. The denominator behind operating rates.">
          {multiLine({ theme, periods: memo.capUtil.periods, fmt: v => `${(v / 1e6).toFixed(2)} Mt/yr`,
            seriesDefs: [{ name: 'Capacity', data: memo.capUtil.data.Capacity, color: theme.series.s5 }] })}
        </Card>

        <Card title="Utilisation rate — by country group" sourceRows={src}
          subtitle="Annual survey. Anonymised groups per competition rules; gaps = suppressed.">
          <Legend items={[{ label: 'All Euro Chlor', color: theme.series.s1 },
            ...memo.utilGroups.keys.slice(0, 5).map((g, i) => (
              { label: GROUP_LABEL(g), color: theme.series[['s2', 's3', 's5', 's6', 's8'][i]] }))]} />
          {multiLine({ theme, periods: memo.utilEU.periods, fmt: v => `${(v).toFixed(1)} %`,
            seriesDefs: [
              { name: 'All Euro Chlor', data: memo.utilEU.data.TOTAL, color: theme.series.s1 },
              ...memo.utilGroups.keys.slice(0, 5).map((g, i) => (
                { name: GROUP_LABEL(g), data: memo.utilGroups.data[g],
                  color: theme.series[['s2', 's3', 's5', 's6', 's8'][i]] })),
            ] })}
        </Card>

        <Card title="Production share by electrolysis technology" sourceRows={src}
          subtitle="Annual survey — the mercury phase-out and membrane conversion, quantified."
          right={<Legend items={Object.entries(TECH_COLORS)
            .filter(([t]) => memo.tech.keys.includes(t))
            .map(([t, s]) => ({ label: t.toLowerCase(), color: theme.series[s] }))} />}>
          {multiLine({ theme, periods: memo.tech.periods, fmt: v => `${v.toFixed(1)} %`,
            seriesDefs: memo.tech.keys.map(t => (
              { name: t.toLowerCase(), data: memo.tech.data[t],
                color: theme.series[TECH_COLORS[t] || 's8'] })) })}
        </Card>

        <Card title={`Chlorine consumption by application — ${memo.latestUseYear}`} sourceRows={src}
          subtitle="Annual survey, main application categories, tonnes Cl2.">
          {memo.uses.length ? (() => {
            const base = baseOption(theme)
            return <EChart height={280} theme={theme} option={{
              ...base,
              grid: { ...base.grid, left: 170, right: 60, bottom: 24 },
              xAxis: { type: 'value', splitLine: { lineStyle: { color: theme.grid, width: 1 } },
                       axisLabel: { color: theme.inkMuted, fontSize: 11, formatter: v => `${(v / 1e6).toFixed(1)} Mt` } },
              yAxis: { type: 'category',
                       data: memo.uses.map(r => r.band.replace(/\s*\(.*$/, '').replace(/^\d+\.\s*/, '').slice(0, 24)),
                       axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
                       axisLabel: { color: theme.inkSecondary, fontSize: 11 } },
              tooltip: { ...base.tooltip, trigger: 'item',
                         formatter: p => `${p.name}: ${(memo.uses[p.dataIndex].value / 1e3).toFixed(0)} kt` },
              series: [{ type: 'bar', barMaxWidth: 16,
                data: memo.uses.map(r => ({ value: Number(r.value),
                  itemStyle: { color: theme.series.s1, borderRadius: [0, 4, 4, 0] } })) }],
            }} />
          })() : <EmptyState>No application split available.</EmptyState>}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card title="Operating rate — EU vs US vs China"
          subtitle="EU & US monthly (Euro Chlor / Chlorine Institute); China plotted flat per year — CCAIA publishes annual figures only."
          sourceRows={[...d.utilEUm.slice(-1), ...d.utilUSm.slice(-1), ...d.utilCNa.slice(-1)]}
          right={<Legend items={[
            { label: 'Euro Chlor', color: theme.series.s1 },
            { label: 'US', color: theme.series.s2 },
            { label: 'China (annual)', color: theme.series.s3 },
          ]} />}>
          {(() => {
            const p = pivot([...d.utilEUm.map(r => ({ ...r, k: 'EU' })),
                             ...d.utilUSm.map(r => ({ ...r, k: 'US' }))], r => r.k)
            const cnByYear = Object.fromEntries(d.utilCNa.map(r => [r.period, Number(r.value)]))
            const cn = p.periods.map(per => cnByYear[per.slice(0, 4)] ?? null)
            return multiLine({ theme, periods: p.periods, fmt: v => `${v.toFixed(1)} %`,
              seriesDefs: [
                { name: 'Euro Chlor', data: p.data.EU, color: theme.series.s1 },
                { name: 'US', data: p.data.US, color: theme.series.s2 },
                { name: 'China (annual)', data: cn, color: theme.series.s3 },
              ] })
          })()}
        </Card>

        <Card title="Utilisation gap — EU − US (monthly, pp)"
          subtitle="Negative = EU plants run lower than US plants. China (CCAIA, annual figures) below the chart."
          sourceRows={[...d.utilUSm.slice(-1)]}>
          {(() => {
            const rows = [...d.gapUS].sort((a, b) => a.period.localeCompare(b.period))
            const base = baseOption(theme)
            return <EChart height={215} theme={theme} option={{
              ...base,
              xAxis: { ...base.xAxis, data: rows.map(r => r.period) },
              tooltip: { ...base.tooltip, valueFormatter: v => `${Number(v).toFixed(1)} pp` },
              series: [
                lineSeries('EU − US', rows.map(r => Number(r.value)), theme.series.s6, theme),
                { type: 'line', data: [], markLine: {
                    silent: true, symbol: 'none', data: [{ yAxis: 0 }],
                    lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
                    label: { show: false } } },
              ],
            }} />
          })()}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {[...d.gapCN].sort((a, b) => a.period.localeCompare(b.period)).map(r => (
              <span key={r.period} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
                border: `1px solid ${theme.border}`, color: Number(r.value) < 0 ? theme.bad : theme.good,
                fontVariantNumeric: 'tabular-nums' }}>
                vs CN {r.period}: {Number(r.value).toFixed(1)} pp
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Caustic soda — sales vs captive use (all Euro Chlor countries)" sourceRows={src}
        subtitle="Annual survey. Captive share signals integration; merchant sales face the import competition shown on the Trade tab."
        right={<Legend items={[
          { label: 'Merchant sales', color: theme.series.s1 },
          { label: 'Captive use', color: theme.series.s5 },
        ]} />}>
        {multiLine({ theme, periods: memo.naohCons.periods, fmt: fmtKt, height: 240,
          seriesDefs: [
            { name: 'Merchant sales', data: memo.naohCons.data.SALES, color: theme.series.s1 },
            { name: 'Captive use', data: memo.naohCons.data.CAPTIVE, color: theme.series.s5 },
          ] })}
      </Card>
    </>
  )
}
