import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchProducts } from '../api'
import { useTheme, PRODUCT_SLOTS } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, StatTile } from '../components'

const fmtM = v => `${(v / 1e6).toFixed(1)} M€`
const fmtKt = v => `${(v / 1e3).toFixed(1)} kt`

// basis = 'value' (€) | 'volume' (t) — set by the App filter row; applies to
// every chart on this tab except import penetration (a share, basis-free)
const BASIS = {
  value: { fmt: fmtM, axis: v => (v / 1e6).toFixed(0), axisUnit: 'M€',
           balanceIndicator: 'trade_balance', series: 'trade.value',
           label: '€ value', listFmt: v => `${(v / 1e6).toFixed(0)} M€` },
  volume: { fmt: fmtKt, axis: v => (v / 1e3).toFixed(0), axisUnit: 'kt',
            balanceIndicator: 'trade_balance_quantity', series: 'trade.quantity',
            label: 'tonnage (as-traded, lye not dry-normalised)',
            listFmt: v => `${(v / 1e3).toFixed(0)} kt` },
}

// last-12-months vs previous-12-months sums, per flow, from monthly series rows
function windowSums(rows) {
  const months = [...new Set(rows.map(r => r.period))].sort()
  const wins = { last: new Set(months.slice(-12)), prev: new Set(months.slice(-24, -12)) }
  const sum = (win, flow) => rows
    .filter(r => wins[win].has(r.period) && (!flow || r.flow === flow))
    .reduce((a, r) => a + Number(r.value), 0)
  return {
    months: months.slice(-12),
    exp: { last: sum('last', 'export'), prev: sum('prev', 'export') },
    imp: { last: sum('last', 'import'), prev: sum('prev', 'import') },
  }
}

const deltaPct = (last, prev) => (prev ? (last - prev) / Math.abs(prev) * 100 : null)
const pct = d => d == null ? null : `${d >= 0 ? '' : '-'}${Math.abs(d).toFixed(1)} %`

export default function Trade({ fromDate, product, productLabel, confirmed, basis = 'value' }) {
  const theme = useTheme()
  const B = BASIS[basis] || BASIS.value
  const [balances, setBalances] = useState(null)   // {value: rows, volume: rows} for product
  const [kpiRows, setKpiRows] = useState(null)     // {qty, val} unfiltered series rows
  const [penetration, setPenetration] = useState(null)
  const [allBalances, setAllBalances] = useState(null)  // {value, volume} all products
  const [basket, setBasket] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchProducts().then(p => setBasket(p.basket)).catch(() => {})
    Promise.all([
      fetchIndicators({ indicator_id: 'trade_balance' }),
      fetchIndicators({ indicator_id: 'trade_balance_quantity' }),
    ]).then(([v, q]) => setAllBalances({ value: v.rows, volume: q.rows })).catch(() => {})
    fetchIndicators({ indicator_id: 'import_penetration' })
      .then(d => setPenetration(d.rows)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!product) return
    setBalances(null); setKpiRows(null)
    Promise.all([
      fetchIndicators({ indicator_id: 'trade_balance', product }),
      fetchIndicators({ indicator_id: 'trade_balance_quantity', product }),
      // unfiltered: KPI windows always need the most recent 24 months
      fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: 'EXTRA_EU', product }),
      fetchSeries({ series_id: 'trade.value', geo: 'EU27_2020', partner: 'EXTRA_EU', product }),
    ]).then(([balV, balQ, qty, val]) => {
      setBalances({ value: balV.rows, volume: balQ.rows })
      setKpiRows({ qty: qty.rows, val: val.rows })
    }).catch(e => setError(String(e)))
  }, [product])

  const balance = useMemo(() => {
    if (!balances) return null
    return (balances[basis] || []).filter(r => !fromDate || r.period_start >= fromDate)
  }, [balances, basis, fromDate])

  const flows = useMemo(() => {
    if (!kpiRows) return null
    const rows = basis === 'volume' ? kpiRows.qty : kpiRows.val
    return rows.filter(r => !fromDate || r.period_start >= fromDate)
  }, [kpiRows, basis, fromDate])

  const balanceOption = useMemo(() => {
    if (!balance?.length) return null
    const base = baseOption(theme)
    return {
      ...base,
      xAxis: { ...base.xAxis, data: balance.map(r => r.period) },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: B.axis } },
      tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' },
                 valueFormatter: v => v == null ? '—' : B.fmt(Number(v)) },
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
  }, [balance, theme, basis])

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
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: B.axis } },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : B.fmt(Number(v)) },
      series: [
        lineSeries('Exports', grab('export'), theme.series.s1, theme),
        lineSeries('Imports', grab('import'), theme.series.s8, theme),
      ],
    }
  }, [flows, theme, basis])

  // ranked net-balance list, last 12 months, all basket products (Flup countries-list style)
  const ranked = useMemo(() => {
    const rows = allBalances?.[basis]
    if (!rows?.length || !basket.length) return null
    const months = [...new Set(rows.map(r => r.period))].sort().slice(-12)
    const inWindow = new Set(months)
    const byProduct = new Map()
    for (const r of rows) {
      if (!inWindow.has(r.period)) continue
      byProduct.set(r.product_code, (byProduct.get(r.product_code) || 0) + Number(r.value))
    }
    const items = basket.map((b, i) => ({
      key: b.key, name: b.name, slot: PRODUCT_SLOTS[i % PRODUCT_SLOTS.length],
      value: b.cn8.reduce((a, c) => a + (byProduct.get(c) || 0), 0),
    })).sort((a, b) => a.value - b.value)
    return { items, months }
  }, [allBalances, basis, basket])

  // product-specific KPI tiles: last 12 months vs previous 12, from full history
  const tiles = useMemo(() => {
    if (!kpiRows) return null
    const q = windowSums(kpiRows.qty)
    const v = windowSums(kpiRows.val)
    const balLast = v.exp.last - v.imp.last
    const balPrev = v.exp.prev - v.imp.prev
    const unitLast = q.imp.last ? v.imp.last / q.imp.last : null
    const unitPrev = q.imp.prev ? v.imp.prev / q.imp.prev : null
    return {
      window: q.months.length ? `${q.months[0]} → ${q.months[q.months.length - 1]}` : '',
      balance: { value: fmtM(balLast), delta: deltaPct(balLast, balPrev) },
      exports: { value: fmtKt(q.exp.last), delta: deltaPct(q.exp.last, q.exp.prev) },
      imports: { value: fmtKt(q.imp.last), delta: deltaPct(q.imp.last, q.imp.prev) },
      unit: unitLast != null
        ? { value: `${unitLast.toFixed(0)} €/t`, delta: deltaPct(unitLast, unitPrev) }
        : null,
    }
  }, [kpiRows])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!product || !balances || !kpiRows) return <EmptyState>Loading…</EmptyState>

  const unconfirmedNote = confirmed ? '' : ' · ⚠ CN8 code pending human confirmation'
  const maxAbs = ranked ? Math.max(...ranked.items.map(i => Math.abs(i.value)), 1) : 1

  return (
    <>
      {tiles && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatTile icon="⚖" label="Net balance, 12 months"
            value={tiles.balance.value} note={tiles.window}
            delta={pct(tiles.balance.delta)} deltaGood={tiles.balance.delta >= 0} />
          <StatTile icon="→" label="Exports, 12 months"
            value={tiles.exports.value} note="extra-EU, tonnage"
            delta={pct(tiles.exports.delta)} deltaGood={tiles.exports.delta >= 0} />
          <StatTile icon="←" label="Imports, 12 months"
            value={tiles.imports.value} note="extra-EU, tonnage"
            delta={pct(tiles.imports.delta)} deltaGood={tiles.imports.delta < 0} />
          <StatTile icon="€" label="Import unit value"
            value={tiles.unit?.value} note="12-month average"
            delta={pct(tiles.unit?.delta)} deltaGood={tiles.unit?.delta >= 0} />
        </div>
      )}
      <Card sourceRows={flows}
        title={`Extra-EU trade balance — ${productLabel}`}
        subtitle={`Monthly exports − imports, ${B.label}. Positive = net exporter.${unconfirmedNote}`}>
        {balanceOption ? <EChart option={balanceOption} height={300} theme={theme} />
          : <EmptyState>No balance rows for this product yet.</EmptyState>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 20 }}>
        <Card sourceRows={flows}
          title={`Export and import ${basis === 'volume' ? 'quantities' : 'values'} — ${productLabel}`}
          subtitle={`Monthly ${B.label}, EU27 vs extra-EU.`}
          right={<Legend items={[
            { label: 'Exports', color: theme.series.s1 },
            { label: 'Imports', color: theme.series.s8 },
          ]} />}>
          {flowOption ? <EChart option={flowOption} height={280} theme={theme} />
            : <EmptyState>No rows yet.</EmptyState>}
        </Card>

        <Card
          title="Net balance by product"
          subtitle={`Last 12 months, extra-EU, ${B.label}.`}>
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
                    {B.listFmt(item.value)}
                  </span>
                </div>
              ))}
            </div>
          ) : <EmptyState>Loading…</EmptyState>}
        </Card>
      </div>

      <Card title="Import penetration — caustic soda"
        subtitle="Extra-EU imports ÷ apparent consumption (PRODCOM sold production + imports − exports), dry basis, annual. Estimated: PRODCOM excludes captive use. (Share — unaffected by the €/t toggle.)">
        {penetration?.length ? (() => {
            const base = baseOption(theme)
            const rows = [...penetration].sort((a, b) => a.period.localeCompare(b.period))
            return <EChart height={230} theme={theme} option={{
              ...base,
              xAxis: { ...base.xAxis, data: rows.map(r => r.period) },
              yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: v => `${(v * 100).toFixed(0)} %` } },
              tooltip: { ...base.tooltip, valueFormatter: v => `${(v * 100).toFixed(1)} %` },
              series: [lineSeries('Penetration', rows.map(r => Number(r.value)), theme.series.s6, theme)],
            }} />
          })() : <EmptyState>Awaiting PRODCOM data.</EmptyState>}
      </Card>
    </>
  )
}
