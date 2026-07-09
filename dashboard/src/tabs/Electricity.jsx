import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { GEO_SLOT, GEO_LABEL, useTheme } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend } from '../components'

const BAND = 'MWH_GE150000'   // largest Eurostat band — chlor-alkali scale
const TAX = 'X_VAT'           // excl. recoverable VAT, incl. non-recoverable levies
const COMPARATORS = ['EU27_2020', 'US', 'CN', 'GULF', 'IN']
const EU_DETAIL = ['EU27_2020', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']

// Align monthly/annual comparator series onto the EU semester grid
// (mirrors the benchmarking agent's alignment, for display only).
function toSemesters(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const sems = /^\d{4}$/.test(r.period)
      ? [`${r.period}-S1`, `${r.period}-S2`]
      : [`${r.period.slice(0, 4)}-S${Number(r.period.slice(5, 7)) <= 6 ? 1 : 2}`]
    for (const sem of sems) {
      if (!buckets.has(sem)) buckets.set(sem, { sample: r, values: [] })
      buckets.get(sem).values.push(Number(r.value))
    }
  }
  return [...buckets.entries()].map(([sem, { sample, values }]) => ({
    ...sample, period: sem,
    value: values.reduce((a, b) => a + b, 0) / values.length,
  }))
}

function pivotOption(rows, geos, theme, unit) {
  const periods = [...new Set(rows.map(r => r.period))].sort()
  const present = geos.filter(g => rows.some(r => r.geo_id === g))
  const byGeo = {}
  for (const g of present) {
    const map = new Map(rows.filter(r => r.geo_id === g).map(r => [r.period, Number(r.value)]))
    byGeo[g] = periods.map(p => map.get(p) ?? null)
  }
  return {
    option: {
      ...baseOption(theme),
      xAxis: { ...baseOption(theme).xAxis, data: periods },
      yAxis: { ...baseOption(theme).yAxis,
               axisLabel: { ...baseOption(theme).yAxis.axisLabel, formatter: `{value}` } },
      tooltip: { ...baseOption(theme).tooltip,
                 valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} ${unit}` },
      series: present.map(g =>
        lineSeries(GEO_LABEL[g] || g, byGeo[g], theme.series[GEO_SLOT[g]], theme)),
    },
    present,
  }
}

export default function Electricity({ fromDate }) {
  const theme = useTheme()
  const [rows, setRows] = useState(null)
  const [ratios, setRatios] = useState(null)
  const [costGap, setCostGap] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'power.industrial_delivered', band: BAND, tax: TAX, from: fromDate }),
      fetchSeries({ series_id: 'power.industrial_delivered', geo: 'US', from: fromDate }),
      fetchIndicators({ indicator_id: 'electricity_cost_ratio' }),
      fetchIndicators({ indicator_id: 'cost_gap' }),
    ]).then(([eu, us, ind, gap]) => {
      setRows([...eu.rows, ...toSemesters(us.rows)])
      setRatios(ind.rows.filter(r => !fromDate || r.period_start >= fromDate))
      setCostGap(gap.rows.filter(r => !fromDate || r.period_start >= fromDate))
    }).catch(e => setError(String(e)))
  }, [fromDate])

  const costGapOption = useMemo(() => {
    if (!costGap?.length) return null
    const comparators = [...new Set(costGap.map(r => r.comparator_geo_id))]
    const geo = comparators.includes('US') ? 'US' : comparators[0]
    const rows2 = costGap.filter(r => r.comparator_geo_id === geo)
      .sort((a, b) => a.period.localeCompare(b.period))
    const base = baseOption(theme)
    const upper = rows2.map(r => r.inputs?.components?.gap_uncompensated_eur_ecu ?? null)
    const lower = rows2.map(r => r.inputs?.components?.gap_max_compensated_eur_ecu ?? null)
    // band = invisible base line at `lower` + stacked fill up to `upper`
    return {
      geo,
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: rows2.map(r => r.period), boundaryGap: false },
        tooltip: { ...base.tooltip,
                   valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(0)} €/ECU` },
        series: [
          { name: '_base', type: 'line', stack: 'band', data: lower,
            lineStyle: { width: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
          { name: '_band', type: 'line', stack: 'band', symbol: 'none', silent: true,
            data: upper.map((u, i) => (u != null && lower[i] != null) ? u - lower[i] : null),
            lineStyle: { width: 0 }, tooltip: { show: false },
            areaStyle: { color: theme.series.s1, opacity: 0.12 } },
          lineSeries('Uncompensated sites', upper, theme.series.s1, theme),
          lineSeries('Maximum ETS compensation', lower, theme.series.s2, theme),
          { type: 'line', data: [], markLine: {
              silent: true, symbol: 'none', data: [{ yAxis: 0 }],
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: 'parity', position: 'insideEndTop',
                       color: theme.inkMuted, fontSize: 10 } } },
        ],
      },
    }
  }, [costGap, theme])

  const ratioOption = useMemo(() => {
    if (!ratios?.length) return null
    const periods = [...new Set(ratios.map(r => r.period))].sort()
    const geos = [...new Set(ratios.map(r => r.comparator_geo_id))]
    return {
      geos,
      option: {
        ...baseOption(theme),
        xAxis: { ...baseOption(theme).xAxis, data: periods },
        tooltip: { ...baseOption(theme).tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(2)}×` },
        series: [
          ...geos.map(g => lineSeries(`EU ÷ ${GEO_LABEL[g] || g}`,
            periods.map(p => {
              const row = ratios.find(r => r.period === p && r.comparator_geo_id === g)
              return row ? Number(row.value) : null
            }), theme.series[GEO_SLOT[g]], theme)),
          { // parity guide at 1×
            type: 'line', markLine: {
              silent: true, symbol: 'none',
              data: [{ yAxis: 1 }],
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: 'parity 1×', position: 'insideEndTop',
                       color: theme.inkMuted, fontSize: 10 },
            }, data: [],
          },
        ],
      },
    }
  }, [ratios, theme])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!rows) return <EmptyState>Loading…</EmptyState>

  const comparatorRows = rows.filter(r => COMPARATORS.includes(r.geo_id))
  const missing = COMPARATORS.filter(g => !rows.some(r => r.geo_id === g))
  const detailRows = rows.filter(r => EU_DETAIL.includes(r.geo_id))

  const cmp = pivotOption(comparatorRows, COMPARATORS, theme, '€/MWh')
  const detail = pivotOption(detailRows, EU_DETAIL, theme, '€/MWh')

  return (
    <>
      <Card sourceRows={costGap}
        title={`Cost gap vs ${costGapOption ? (GEO_LABEL[costGapOption.geo] || costGapOption.geo) : 'comparator'} — € per tonne ECU`}
        subtitle="The headline: measured power-price gap × 2.629 MWh/ECU (CO2 pass-through is inside the price — not double-counted). Band = value of maximum ETS indirect-cost compensation; actual schemes have national caps, so reality sits inside the band. Member states without compensation sit on the top line."
        right={costGapOption && <Legend items={[
          { label: 'Uncompensated sites', color: theme.series.s1 },
          { label: 'Max ETS compensation', color: theme.series.s2 },
        ]} />}>
        {costGapOption
          ? <EChart option={costGapOption.option} height={280} theme={theme} />
          : <EmptyState>Cost gap computes once comparator power + EUA data are present.</EmptyState>}
      </Card>

      <Card sourceRows={comparatorRows}
        title="Industrial delivered electricity price — EU vs world regions"
        subtitle={`Delivered price (energy + network + non-recoverable levies), band ≥150 GWh/yr.${
          missing.length ? ` Awaiting data: ${missing.map(g => GEO_LABEL[g]).join(', ')}.` : ''}`}
        right={<Legend items={cmp.present.map(g => ({ label: GEO_LABEL[g] || g, color: theme.series[GEO_SLOT[g]] }))} />}>
        <EChart option={cmp.option} height={320} theme={theme} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card sourceRows={ratios}
          title="Electricity cost ratio — EU ÷ comparator"
          subtitle="Above 1× means EU industry pays more. Methodology v1.0.">
          {ratioOption ? (
            <>
              <Legend items={ratioOption.geos.map(g => ({ label: `÷ ${GEO_LABEL[g] || g}`, color: theme.series[GEO_SLOT[g]] }))} />
              <EChart option={ratioOption.option} height={266} theme={theme} />
            </>
          ) : <EmptyState>No ratios yet — they compute once a comparator power series is ingested.</EmptyState>}
        </Card>

        <Card sourceRows={detailRows}
          title="EU member state detail"
          subtitle="Same delivered-price basis, chlor-alkali producing countries.">
          <Legend items={detail.present.map(g => ({ label: GEO_LABEL[g] || g, color: theme.series[GEO_SLOT[g]] }))} />
          <EChart option={detail.option} height={266} theme={theme} />
        </Card>
      </div>
    </>
  )
}
