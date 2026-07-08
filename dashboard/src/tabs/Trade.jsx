import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { fetchSeries, fetchIndicators } from '../api'
import { ChartCard, EmptyState, Legend, makeTooltip } from '../components'

const fmtM = v => `${(v / 1e6).toFixed(1)} M€`
const fmtKt = v => `${(v / 1e3).toFixed(1)} kt`

export default function Trade({ theme, fromDate, product, productLabel, confirmed }) {
  const [balance, setBalance] = useState(null)
  const [flows, setFlows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!product) return
    setBalance(null); setFlows(null)
    Promise.all([
      fetchIndicators({ indicator_id: 'trade_balance', product }),
      fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: 'EXTRA_EU', product, from: fromDate }),
    ]).then(([bal, qty]) => {
      setBalance(bal.rows.filter(r => !fromDate || r.period_start >= fromDate))
      setFlows(qty.rows)
    }).catch(e => setError(String(e)))
  }, [product, fromDate])

  if (error) return <EmptyState theme={theme}>Failed to load: {error}</EmptyState>
  if (!product) return <EmptyState theme={theme}>Select a product above.</EmptyState>
  if (!balance || !flows) return <EmptyState theme={theme}>Loading…</EmptyState>

  const balData = balance.map(r => ({ period: r.period, value: Number(r.value) }))
  const flowData = (() => {
    const byPeriod = new Map()
    for (const r of flows) {
      if (!byPeriod.has(r.period)) byPeriod.set(r.period, { period: r.period })
      byPeriod.get(r.period)[r.flow] = Number(r.value)
    }
    return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
  })()

  const BalTooltip = makeTooltip(theme, fmtM)
  const FlowTooltip = makeTooltip(theme, fmtKt)
  const unconfirmedNote = confirmed ? '' : ' · ⚠ CN8 code pending human confirmation'

  return (
    <>
      <ChartCard theme={theme} sourceRows={flows}
        title={`Extra-EU trade balance — ${productLabel}`}
        subtitle={`Monthly exports − imports, EU27 vs extra-EU, € value. Positive = net exporter.${unconfirmedNote}`}>
        {balData.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={balData} margin={{ top: 8, right: 24, bottom: 4, left: 8 }} barCategoryGap={2}>
              <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: theme.inkMuted }}
                     stroke={theme.axis} tickLine={false} minTickGap={50} />
              <YAxis tickFormatter={v => (v / 1e6).toFixed(0)}
                     tick={{ fontSize: 11, fill: theme.inkMuted, fontVariantNumeric: 'tabular-nums' }}
                     stroke={theme.axis} tickLine={false} axisLine={false}
                     label={{ value: 'M€', angle: -90, position: 'insideLeft',
                              style: { fontSize: 11, fill: theme.inkMuted } }} />
              <Tooltip content={<BalTooltip />} cursor={{ fill: theme.grid, opacity: 0.4 }} />
              <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1} />
              <Bar dataKey="value" name="Balance" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {balData.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? theme.divergingPos : theme.divergingNeg} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState theme={theme}>No balance rows for this product yet.</EmptyState>}
      </ChartCard>

      <ChartCard theme={theme} sourceRows={flows}
        title={`Export and import quantities — ${productLabel}`}
        subtitle="Monthly tonnage, EU27 vs extra-EU (Comext 100 kg normalised to tonnes).">
        {flowData.length ? (
          <>
            <Legend items={[
              { label: 'Exports', color: theme.series.s1 },
              { label: 'Imports', color: theme.series.s8 },
            ]} theme={theme} />
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={flowData} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: theme.inkMuted }}
                       stroke={theme.axis} tickLine={false} minTickGap={50} />
                <YAxis tickFormatter={v => (v / 1e3).toFixed(0)}
                       tick={{ fontSize: 11, fill: theme.inkMuted, fontVariantNumeric: 'tabular-nums' }}
                       stroke={theme.axis} tickLine={false} axisLine={false}
                       label={{ value: 'kt', angle: -90, position: 'insideLeft',
                                style: { fontSize: 11, fill: theme.inkMuted } }} />
                <Tooltip content={<FlowTooltip />} cursor={{ stroke: theme.axis, strokeWidth: 1 }} />
                <Line dataKey="export" name="Exports" stroke={theme.series.s1} strokeWidth={2}
                      dot={false} activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} connectNulls />
                <Line dataKey="import" name="Imports" stroke={theme.series.s8} strokeWidth={2}
                      dot={false} activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : <EmptyState theme={theme}>No quantity rows for this product yet.</EmptyState>}
      </ChartCard>
    </>
  )
}
