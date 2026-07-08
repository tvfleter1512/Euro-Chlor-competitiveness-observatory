import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchProducts } from '../api'
import { useTheme, PRODUCT_SLOTS } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend } from '../components'

const fmtM = v => `${(v / 1e6).toFixed(1)} M€`
const fmtKt = v => `${(v / 1e3).toFixed(1)} kt`

export default function Trade({ fromDate, product, productLabel, confirmed }) {
  const theme = useTheme()
  const [balance, setBalance] = useState(null)
  const [flows, setFlows] = useState(null)
  const [allBalance, setAllBalance] = useState(null)
  const [basket, setBasket] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchProducts().then(p => setBasket(p.basket)).catch(() => {})
    fetchIndicators({ indicator_id: 'trade_balance' })
      .then(d => setAllBalance(d.rows)).catch(() => {})
  }, [])

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

  const balanceOption = useMemo(() => {
    if (!balance?.length) return null
    const base = baseOption(theme)
    return {
      ...base,
      xAxis: { ...base.xAxis, data: balance.map(r => r.period) },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: v => (v / 1e6).toFixed(0) } },
      tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' },
                 valueFormatter: v => v == null ? '—' : fmtM(Number(v)) },
      series: [{
        name: 'Balance', type: 'bar', barMaxWidth: 24, barCategoryGap: '20%',
        data: balance.map(r => {
          const v = Number(r.value)
          return {
            value: v,
            itemStyle: {
              color: v >= 0 ? theme.divergingPos : theme.divergingNeg,
              borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
            },
          }
        }),
      }],
    }
  }, [balance, theme])

  const flowOption = useMemo(() => {
    if (!flows?.length) return null
    const base = baseOption(theme)
    const periods = [...new Set(flows.map(r => r.period))].sort()
    const grab = (flow) => {
      const m = new Map(flows.filter(r => r.flow === flow).map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      ...base,
      xAxis: { ...base.xAxis, data: periods },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: v => (v / 1e3).toFixed(0) } },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : fmtKt(Number(v)) },
      series: [
        lineSeries('Exports', grab('export'), theme.series.s1, theme),
        lineSeries('Imports', grab('import'), theme.series.s8, theme),
      ],
    }
  }, [flows, theme])

  // ranked net-balance list, last 12 months, all basket products (Flup countries-list style)
  const ranked = useMemo(() => {
    if (!allBalance?.length || !basket.length) return null
    const months = [...new Set(allBalance.map(r => r.period))].sort().slice(-12)
    const inWindow = new Set(months)
    const byProduct = new Map()
    for (const r of allBalance) {
      if (!inWindow.has(r.period)) continue
      byProduct.set(r.product_code, (byProduct.get(r.product_code) || 0) + Number(r.value))
    }
    const items = basket.map((b, i) => ({
      key: b.key, name: b.name, slot: PRODUCT_SLOTS[i % PRODUCT_SLOTS.length],
      value: b.cn8.reduce((a, c) => a + (byProduct.get(c) || 0), 0),
    })).sort((a, b) => a.value - b.value)
    return { items, months }
  }, [allBalance, basket])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!product || !balance || !flows) return <EmptyState>Loading…</EmptyState>

  const unconfirmedNote = confirmed ? '' : ' · ⚠ CN8 code pending human confirmation'
  const maxAbs = ranked ? Math.max(...ranked.items.map(i => Math.abs(i.value)), 1) : 1

  return (
    <>
      <Card sourceRows={flows}
        title={`Extra-EU trade balance — ${productLabel}`}
        subtitle={`Monthly exports − imports, € value. Positive = net exporter.${unconfirmedNote}`}>
        {balanceOption ? <EChart option={balanceOption} height={300} theme={theme} />
          : <EmptyState>No balance rows for this product yet.</EmptyState>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 20 }}>
        <Card sourceRows={flows}
          title={`Export and import quantities — ${productLabel}`}
          subtitle="Monthly tonnage, EU27 vs extra-EU."
          right={<Legend items={[
            { label: 'Exports', color: theme.series.s1 },
            { label: 'Imports', color: theme.series.s8 },
          ]} />}>
          {flowOption ? <EChart option={flowOption} height={280} theme={theme} />
            : <EmptyState>No quantity rows yet.</EmptyState>}
        </Card>

        <Card
          title="Net balance by product"
          subtitle="Last 12 months, extra-EU, € value.">
          {ranked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ranked.items.map(item => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4,
                                 background: theme.series[item.slot], flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: theme.inkSecondary, flex: 1,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                  <div style={{ width: 70, height: 6, borderRadius: 3, background: theme.grid,
                                position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: item.value < 0 ? `${50 - Math.abs(item.value) / maxAbs * 50}%` : '50%',
                      width: `${Math.abs(item.value) / maxAbs * 50}%`,
                      background: item.value >= 0 ? theme.divergingPos : theme.divergingNeg,
                      borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums',
                                 color: item.value >= 0 ? theme.good : theme.bad,
                                 width: 78, textAlign: 'right', flexShrink: 0 }}>
                    {(item.value / 1e6).toFixed(0)} M€
                  </span>
                </div>
              ))}
            </div>
          ) : <EmptyState>Loading…</EmptyState>}
        </Card>
      </div>
    </>
  )
}
