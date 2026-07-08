import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchSeries, fetchIndicators } from '../api'
import { GEO_SLOT, GEO_LABEL } from '../theme'
import { ChartCard, EmptyState, Legend, makeTooltip } from '../components'

const BAND = 'MWH_GE150000'   // largest Eurostat band — chlor-alkali scale
const TAX = 'X_VAT'           // excl. recoverable VAT, incl. non-recoverable levies
const COMPARATORS = ['EU27_2020', 'US', 'CN', 'GULF', 'IN']
const EU_DETAIL = ['EU27_2020', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']

function pivot(rows, geos) {
  const byPeriod = new Map()
  for (const r of rows) {
    if (!geos.includes(r.geo_id)) continue
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, { period: r.period })
    byPeriod.get(r.period)[r.geo_id] = Number(r.value)
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
}

function PriceChart({ rows, geos, theme }) {
  const data = pivot(rows, geos)
  const present = geos.filter(g => rows.some(r => r.geo_id === g))
  const CustomTooltip = makeTooltip(theme, v => `${v.toFixed(1)} €/MWh`)
  return (
    <>
      <Legend items={present.map(g => ({ label: GEO_LABEL[g] || g, color: theme.series[GEO_SLOT[g]] }))} theme={theme} />
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: theme.inkMuted }}
                 stroke={theme.axis} tickLine={false} minTickGap={40} />
          <YAxis tick={{ fontSize: 11, fill: theme.inkMuted, fontVariantNumeric: 'tabular-nums' }}
                 stroke={theme.axis} tickLine={false} axisLine={false}
                 label={{ value: '€/MWh', angle: -90, position: 'insideLeft',
                          style: { fontSize: 11, fill: theme.inkMuted } }} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: theme.axis, strokeWidth: 1 }} />
          {present.map(g => (
            <Line key={g} dataKey={g} name={GEO_LABEL[g] || g}
                  stroke={theme.series[GEO_SLOT[g]]} strokeWidth={2}
                  dot={false} strokeLinejoin="round" strokeLinecap="round"
                  activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
                  connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

export default function Electricity({ theme, fromDate }) {
  const [rows, setRows] = useState(null)
  const [ratios, setRatios] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'power.industrial_delivered', band: BAND, tax: TAX, from: fromDate }),
      fetchSeries({ series_id: 'power.industrial_delivered', geo: 'US', from: fromDate }),
      fetchSeries({ series_id: 'power.industrial_delivered', quality: undefined, from: fromDate }),
      fetchIndicators({ indicator_id: 'electricity_cost_ratio' }),
    ]).then(([eu, us, , ind]) => {
      setRows([...eu.rows, ...us.rows])
      setRatios(ind.rows)
    }).catch(e => setError(String(e)))
  }, [fromDate])

  if (error) return <EmptyState theme={theme}>Failed to load: {error}</EmptyState>
  if (!rows) return <EmptyState theme={theme}>Loading…</EmptyState>

  const comparatorRows = rows.filter(r =>
    r.geo_id === 'EU27_2020' || COMPARATORS.includes(r.geo_id))
  const missing = COMPARATORS.filter(g => !rows.some(r => r.geo_id === g))
  const detailRows = rows.filter(r => EU_DETAIL.includes(r.geo_id))
  const CustomRatioTooltip = makeTooltip(theme, v => `${v.toFixed(2)}×`)

  const ratioData = (() => {
    if (!ratios?.length) return []
    const byPeriod = new Map()
    for (const r of ratios) {
      if (!byPeriod.has(r.period)) byPeriod.set(r.period, { period: r.period })
      byPeriod.get(r.period)[r.comparator_geo_id] = Number(r.value)
    }
    return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
  })()
  const ratioGeos = [...new Set((ratios || []).map(r => r.comparator_geo_id))]

  return (
    <>
      <ChartCard theme={theme} sourceRows={comparatorRows}
        title="Industrial delivered electricity price — EU vs world regions"
        subtitle={`Delivered price (energy + network + non-recoverable levies), band ≥150 GWh/yr, semi-annual.${
          missing.length ? ` Awaiting data: ${missing.map(g => GEO_LABEL[g]).join(', ')} (API key or curated tariffs pending).` : ''}`}>
        <PriceChart rows={comparatorRows} geos={COMPARATORS} theme={theme} />
      </ChartCard>

      <ChartCard theme={theme} sourceRows={ratios}
        title="Electricity cost ratio — EU ÷ comparator"
        subtitle="Above 1× means EU industry pays more. Computed indicator, methodology v1.0.">
        {ratioData.length ? (
          <>
            <Legend items={ratioGeos.map(g => ({ label: `EU ÷ ${GEO_LABEL[g] || g}`, color: theme.series[GEO_SLOT[g]] }))} theme={theme} />
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={ratioData} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: theme.inkMuted }}
                       stroke={theme.axis} tickLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: theme.inkMuted, fontVariantNumeric: 'tabular-nums' }}
                       stroke={theme.axis} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                <Tooltip content={<CustomRatioTooltip />} cursor={{ stroke: theme.axis, strokeWidth: 1 }} />
                {ratioGeos.map(g => (
                  <Line key={g} dataKey={g} name={`EU ÷ ${GEO_LABEL[g] || g}`}
                        stroke={theme.series[GEO_SLOT[g]]} strokeWidth={2} dot={false}
                        activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <EmptyState theme={theme}>
            No ratios yet — they compute automatically once a comparator power series
            is ingested (US: set EIA_KEY; CN/Gulf/India: drop curated tariff CSVs).
          </EmptyState>
        )}
      </ChartCard>

      <ChartCard theme={theme} sourceRows={detailRows}
        title="EU member state detail"
        subtitle="Same delivered-price basis, selected chlor-alkali producing countries.">
        <PriceChart rows={detailRows} geos={EU_DETAIL} theme={theme} />
      </ChartCard>
    </>
  )
}
