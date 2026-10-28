import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchProducts, fetchAlerts, fetchTradePartners, fetchTradeDefence } from '../api'
import { useTheme, PARTNER_SLOT, FONT } from '../theme'
import EChart, { baseOption, yearTicks } from '../EChart'
import { Card, EmptyState, Legend, SectionHeading, StatTile } from '../components'
import { groupAlerts } from '../alerts'
import { forProduct, euMeasureOn, measureAgainstEU, markers, shortLabel } from '../tdlinks'
import TradeDefence from './TradeDefence'
import CompetitorExports from './CompetitorExports'
import TradeMap from './TradeMap'
import { DependencyScreening, DependencyDetail } from './Dependency'

const fmtM = v => `${(v / 1e6).toFixed(1)} M€`
const fmtKt = v => `${(v / 1e3).toFixed(1)} kt`

// basis = 'value' (€) | 'volume' (t) — set by the App filter row; applies to
// every chart on this tab except the dependency tests and the screening table
const BASIS = {
  value: { fmt: fmtM, axis: v => (v / 1e6).toFixed(0), axisUnit: 'M€',
           balanceIndicator: 'trade_balance', series: 'trade.value',
           label: '€ value', listFmt: v => `${(v / 1e6).toFixed(0)} M€` },
  volume: { fmt: fmtKt, axis: v => (v / 1e3).toFixed(0), axisUnit: 'kt',
            balanceIndicator: 'trade_balance_quantity', series: 'trade.quantity',
            label: 'tonnage (as-traded, lye not dry-normalised)',
            listFmt: v => `${(v / 1e3).toFixed(0)} kt` },
}

const FLOW_LABEL = { import: 'Imports by origin', export: 'Exports by destination' }
const TEST_LABEL = { month: 'latest month', quarter: '3-month average', price: 'unit value' }
const KIND_TEST = { month: 'month', quarter: '3-month', price: '' }
const KIND_LABEL = { trade_surge: 'Volume rise', trade_price_drop: 'Price drop' }

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
const x = r => r == null ? '—' : `×${r >= 10 ? r.toFixed(0) : r.toFixed(1)}`

export default function Trade({ fromDate, product, productLabel, confirmed, basis = 'value', setProduct, products = [] }) {
  const theme = useTheme()
  const B = BASIS[basis] || BASIS.value
  const [balances, setBalances] = useState(null)   // {value: rows, volume: rows} for product
  const [kpiRows, setKpiRows] = useState(null)     // {qty, val} unfiltered series rows
  const [allBalances, setAllBalances] = useState(null)  // {value, volume} all products
  const [basket, setBasket] = useState([])
  const [pflow, setPflow] = useState('import')      // partner section: imports | exports
  const [partners, setPartners] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [measures, setMeasures] = useState([])   // config/trade_defence.yaml
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchProducts().then(p => setBasket(p.basket)).catch(() => {})
    Promise.all([
      fetchIndicators({ indicator_id: 'trade_balance' }),
      fetchIndicators({ indicator_id: 'trade_balance_quantity' }),
    ]).then(([v, q]) => setAllBalances({ value: v.rows, volume: q.rows })).catch(() => {})
    fetchAlerts(6).then(d => setAlerts(d.rows)).catch(() => {})
    fetchTradeDefence().then(d => setMeasures(d.measures)).catch(() => {})
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

  useEffect(() => {
    if (!product) return
    setPartners(null)
    fetchTradePartners({ product, flow: pflow, series_id: B.series, top: 6, from: fromDate })
      .then(setPartners).catch(e => setError(String(e)))
  }, [product, pflow, basis, fromDate])

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
      xAxis: { ...yearTicks(base), data: balance.map(r => r.period) },
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

  const hs6Of = cn8 => basket.find(b => b.cn8.includes(cn8))?.hs6
  const hs6 = hs6Of(product)

  // by-partner stacked bars: top-6 partners in fixed entity colours + Other
  const partnerColor = geo => PARTNER_SLOT[geo] ? theme.series[PARTNER_SLOT[geo]] : theme.inkMuted
  const partnerOption = useMemo(() => {
    if (!partners?.periods?.length) return null
    const base = baseOption(theme)
    const stack = (name, data, color, last) => ({
      name, type: 'bar', stack: 'flow', data, barMaxWidth: 26, barCategoryGap: '25%',
      itemStyle: { color, borderColor: theme.surface, borderWidth: 1,
                   borderRadius: last ? [3, 3, 0, 0] : 0 },
      emphasis: { focus: 'series' },
    })
    return {
      ...base,
      xAxis: { ...yearTicks(base), data: partners.periods },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: B.axis } },
      tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' }, order: 'seriesDesc',
                 valueFormatter: v => v == null ? '—' : B.fmt(Number(v)) },
      series: [
        ...partners.series.map(s => stack(s.name, s.values, partnerColor(s.geo), false)),
        stack('Other', partners.other, theme.inkMuted, true),
        // trade-defence dates: EU measures on imports, or partners' measures on EU exports
        ...markers(forProduct(measures, hs6).filter(m => pflow === 'import'
          ? m.imposing === 'EU' : m.targets?.includes('EU')), partners.periods, theme),
      ],
    }
  }, [partners, theme, basis, measures, hs6, pflow])

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
    const items = basket.map(b => ({
      key: b.key, name: b.name, cn8: b.cn8,
      value: b.cn8.reduce((a, c) => a + (byProduct.get(c) || 0), 0),
    })).sort((a, b) => a.value - b.value)
    return { items, months }
  }, [allBalances, basis, basket])

  // diverging bars around zero: net importers left (red), net exporters right (blue)
  const rankedOption = useMemo(() => {
    if (!ranked) return null
    const base = baseOption(theme)
    const items = [...ranked.items].reverse()        // largest net exporter on top
    const sel = items.find(i => i.cn8.includes(product))?.name
    return { items, option: {
      ...base,
      grid: { left: 250, right: 70, top: 6, bottom: 24 },
      // headroom on the negative side so the value labels of the largest importer stay clear of the names
      xAxis: { type: 'value', splitLine: { lineStyle: { color: theme.grid, width: 1 } },
               min: v => v.min < 0 ? v.min * 1.3 : 0,
               axisLabel: { color: theme.inkMuted, fontSize: 11, formatter: B.axis, showMinLabel: false } },
      yAxis: { type: 'category', data: items.map(i => i.name), axisTick: { show: false },
               axisLine: { show: false },
               axisLabel: { color: theme.inkSecondary, fontSize: 12, width: 240, overflow: 'truncate',
                            formatter: v => v === sel ? `{sel|${v}}` : v,
                            rich: { sel: { fontWeight: 700, color: theme.ink, fontSize: 12 } } } },
      tooltip: { ...base.tooltip, trigger: 'item', formatter: p => `${p.name}: <b>${B.fmt(items[p.dataIndex].value)}</b> net, last 12 months` },
      series: [{
        type: 'bar', barMaxWidth: 16, cursor: 'pointer',
        data: items.map(i => ({ value: i.value, itemStyle: {
          color: i.value >= 0 ? theme.divergingPos : theme.divergingNeg,
          borderRadius: i.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
        label: { show: true, color: theme.inkSecondary, fontSize: 11,
                 position: 'right', formatter: p => B.listFmt(items[p.dataIndex].value) },
        labelLayout: p => ({ align: items[p.dataIndex].value < 0 ? 'right' : 'left',
                             x: items[p.dataIndex].value < 0 ? p.rect.x - 6 : p.rect.x + p.rect.width + 6 }),
        markLine: { silent: true, symbol: 'none', data: [{ xAxis: 0 }],
                    lineStyle: { color: theme.inkMuted, width: 1, type: 'solid' }, label: { show: false } },
      }],
    } }
  }, [ranked, theme, basis, product])

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

  const alertGroups = useMemo(() => groupAlerts(alerts), [alerts])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!product || !balances || !kpiRows) return <EmptyState>Loading…</EmptyState>

  const unconfirmedNote = confirmed ? '' : ' · ⚠ CN8 code pending human confirmation'
  const sevColor = s => s === 'high' ? theme.status.critical : theme.status.warning
  const chip = (s) => ({
    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    padding: '2px 8px', borderRadius: 999, border: `1px solid ${sevColor(s)}`, color: sevColor(s),
    whiteSpace: 'nowrap',
  })
  const toggle = (active) => ({
    padding: '4px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 999, border: 'none',
    fontFamily: FONT, fontWeight: 600,
    background: active ? theme.accent : 'transparent', color: active ? '#fff' : theme.inkSecondary,
  })
  const th = { textAlign: 'right', padding: '8px 10px', fontSize: 10.5, color: theme.inkMuted,
               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
               borderBottom: `1px solid ${theme.grid}`, whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '7px 10px', fontSize: 12.5, color: theme.ink,
               borderBottom: `1px solid ${theme.grid}`, fontVariantNumeric: 'tabular-nums',
               whiteSpace: 'nowrap' }
  const fmtCell = v => v == null ? '—' : fmtKt(Number(v))   // screening table is always tonnes
  const tdTag = { marginLeft: 8, fontSize: 10.5, fontWeight: 650, padding: '1px 7px', borderRadius: 999,
                  border: `1px solid ${theme.status.serious}`, color: theme.ink, whiteSpace: 'nowrap' }
  const picker = products.length > 0 && (
    <select value={product || ''} onChange={e => setProduct(e.target.value)} aria-label="Product"
      style={{ padding: '7px 12px', fontSize: 13, fontFamily: FONT, fontWeight: 650, color: theme.ink, maxWidth: '100%',
               background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 999 }}>
      {products.map(b => <option key={b.product_code} value={b.product_code}>{b.name} ({b.product_code})</option>)}
    </select>
  )

  return (
    <>
      <SectionHeading title="All basket products"
        subtitle="Where the EU is a net importer, where imports jumped or prices dropped, and the Commission's dependency screening." />

      <Card title={`Net trade balance by product, last 12 months`}
        subtitle={`Extra-EU exports − imports, ${B.label}. Left of zero (red) = the EU imports more than it exports. Click a bar to open the product below.`}>
        {rankedOption ? <EChart option={rankedOption.option} height={Math.max(200, rankedOption.items.length * 30 + 30)} theme={theme}
                                onClick={p => setProduct?.(rankedOption.items[p.dataIndex]?.cn8[0])} />
          : <EmptyState>Loading…</EmptyState>}
      </Card>

      <Card title="Where imports jumped or prices dropped — all products"
        subtitle="Open signals from the last 6 months, strongest per product, flow and partner. Click a row to open that product."
        method="Screened after every Comext update. Volume rise: latest month vs the previous 12 (must exceed 2.5× the mean and 1.5× the maximum), or 3-month average vs the previous 12 (1.75×). Price drop: the partner's unit value (€/t) down 20 % (month) or 15 % (3-month) vs its own previous 12 months. Both need at least 5 kt and a 10 % share. Thresholds in config/surges.yaml, pending owner confirmation.">
        {alertGroups.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Severity</th>
                <th style={{ ...th, textAlign: 'left' }}>Signal</th>
                <th style={{ ...th, textAlign: 'left' }}>Product</th>
                <th style={{ ...th, textAlign: 'left' }}>Flow · partner</th>
                <th style={th}>Period</th><th style={th}>Level</th><th style={th}>vs previous 12 m</th>
                <th style={th}>Share</th>
              </tr></thead>
              <tbody>
                {alertGroups.map(({ lead: a, periods }) => {
                  const inp = a.inputs || {}
                  const mine = a.product_code === product
                  return (
                    <tr key={`${a.product_code}${a.flow}${a.partner_geo_id}`}
                        onClick={() => { setProduct?.(a.product_code); setPflow(a.flow) }}
                        style={{ cursor: 'pointer', background: mine ? theme.accentSoft : 'transparent' }}>
                      <td style={{ ...td, textAlign: 'left' }}><span style={chip(a.severity)}>{a.severity}</span></td>
                      <td style={{ ...td, textAlign: 'left', color: theme.inkSecondary }}>
                        {KIND_LABEL[a.kind] || a.kind}{KIND_TEST[a.test] ? `, ${KIND_TEST[a.test]}` : ''}</td>
                      <td style={{ ...td, textAlign: 'left', fontWeight: mine ? 650 : 500, whiteSpace: 'normal' }}>{a.product_name}</td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        {a.flow === 'import' ? 'from' : 'to'}{' '}
                        {a.partner_geo_id === 'EXTRA_EU' ? 'all extra-EU' : `${a.partner_name} (${a.partner_geo_id})`}
                        {(() => {
                          const m = a.flow === 'import' ? euMeasureOn(measures, hs6Of(a.product_code), a.partner_geo_id)
                                                        : measureAgainstEU(measures, hs6Of(a.product_code), a.partner_geo_id)
                          return m && <span title={`${m.duty || ''} ${m.case_ref || ''}`} style={tdTag}>{shortLabel(m)}</span>
                        })()}
                      </td>
                      <td style={td}>{a.period}{periods.size > 1 ? ` +${periods.size - 1}` : ''}</td>
                      <td style={td}>{a.kind === 'trade_price_drop' ? `${Number(a.value).toFixed(0)} €/t on ${fmtKt(inp.quantity_t)}` : fmtKt(Number(a.value))}</td>
                      <td style={{ ...td, color: a.kind === 'trade_price_drop' ? theme.bad : theme.ink }}>{a.kind === 'trade_price_drop' ? `−${(inp.drop * 100).toFixed(0)} % (${Number(inp.baseline_uv).toFixed(0)} €/t)` : inp.new_origin ? 'new' : x(inp.ratio)}</td>
                      <td style={td}>{inp.share == null ? '—' : `${(inp.share * 100).toFixed(0)} %`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No open alerts in the last 6 months.</EmptyState>}
      </Card>

      <DependencyScreening product={product} setProduct={setProduct} />

      <SectionHeading title={`Selected product — ${productLabel}`}
        subtitle="Everything below follows this product. Pick one here, or click a product above."
        right={picker} />

      {tiles && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatTile icon="⚖" label="Net balance, 12 months"
            value={tiles.balance.value} note={`€ value · ${tiles.window}`}
            delta={pct(tiles.balance.delta)} deltaGood={tiles.balance.delta >= 0} />
          <StatTile icon="→" label="Exports, 12 months"
            value={tiles.exports.value} note="extra-EU, tonnes"
            delta={pct(tiles.exports.delta)} deltaGood={tiles.exports.delta >= 0} />
          <StatTile icon="←" label="Imports, 12 months"
            value={tiles.imports.value} note="extra-EU, tonnes"
            delta={pct(tiles.imports.delta)} deltaGood={tiles.imports.delta < 0} />
          {tiles.unit && <StatTile icon="€" label="Import price, 12 months"
            value={tiles.unit.value} note="average € per tonne imported"
            delta={pct(tiles.unit.delta)} deltaGood={tiles.unit.delta >= 0} />}
        </div>
      )}

      <Card sourceRows={flows}
        title={`Extra-EU trade balance — ${productLabel}`}
        subtitle={`Monthly exports − imports, ${B.label}. Above zero = the EU exports more than it imports.${unconfirmedNote}`}>
        {balanceOption ? <EChart option={balanceOption} height={260} theme={theme} />
          : <EmptyState>No balance rows for this product yet.</EmptyState>}
      </Card>

      <TradeMap product={product} productLabel={productLabel} basis={basis} />

      <Card sourceRows={flows}
        title={`${FLOW_LABEL[pflow]} — ${productLabel}`}
        subtitle={`Monthly extra-EU ${B.label}, top-6 partners by the last 12 months; the rest as Other. Dashed markers: trade-defence steps.${unconfirmedNote}`}
        right={
          <span style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999,
                         background: theme.page, border: `1px solid ${theme.border}` }}>
            {[['import', 'Imports'], ['export', 'Exports']].map(([k, l]) => (
              <button key={k} onClick={() => setPflow(k)} style={toggle(pflow === k)}>{l}</button>
            ))}
          </span>
        }>
        {partners?.series?.length ? (
          <>
            <Legend items={[...partners.series.map(s => ({ label: `${s.name} (${s.geo})`, color: partnerColor(s.geo) })),
                             { label: 'Other', color: theme.inkMuted }]} />
            <EChart option={partnerOption} height={300} theme={theme} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 650, color: theme.ink }}>
                Partner screening table{partners.stats.some(s => s.flags.length) ? ' — partners flagged' : ''}</summary>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Partner</th>
                  <th style={th}>{partners.latest_period}</th><th style={th}>12-m mean</th>
                  <th style={th}>× mean</th><th style={th}>12-m max</th>
                  <th style={th}>3-m avg</th><th style={th}>× prior 12</th>
                  <th style={th}>Share</th><th style={th}>€/t latest</th><th style={th}>€/t 12-m</th><th style={th}>Δ €/t</th>
                  <th style={{ ...th, textAlign: 'left' }}>Flag</th>
                </tr></thead>
                <tbody>
                  {partners.stats.slice(0, 12).map(s => (
                    <tr key={s.geo} style={{ background: s.flags.length ? theme.accentSoft : 'transparent' }}>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                                       background: partnerColor(s.geo), marginRight: 8 }} />
                        {s.name} <span style={{ color: theme.inkMuted }}>({s.geo})</span>
                      </td>
                      <td style={{ ...td, fontWeight: 650 }}>{fmtCell(s.latest)}</td>
                      <td style={td}>{fmtCell(s.mean12)}</td>
                      <td style={{ ...td, color: s.ratio >= 2.5 ? theme.bad : theme.ink }}>{x(s.ratio)}</td>
                      <td style={td}>{fmtCell(s.max12)}</td>
                      <td style={td}>{fmtCell(s.avg3)}</td>
                      <td style={{ ...td, color: s.ratio3 >= 1.75 ? theme.bad : theme.ink }}>{x(s.ratio3)}</td>
                      <td style={td}>{s.share == null ? '—' : `${(s.share * 100).toFixed(0)} %`}</td>
                      <td style={td}>{s.uv == null ? '—' : s.uv.toFixed(0)}</td>
                      <td style={td}>{s.uv12 == null ? '—' : s.uv12.toFixed(0)}</td>
                      <td style={{ ...td, color: s.uv_change != null && s.uv_change <= -0.2 ? theme.bad : theme.ink }}>{s.uv_change == null ? '—' : `${s.uv_change >= 0 ? '+' : '−'}${Math.abs(s.uv_change * 100).toFixed(0)} %`}</td>
                      <td style={{ ...td, textAlign: 'left', color: theme.status.critical, fontWeight: 650 }}>
                        {s.flags.map(f => TEST_LABEL[f]).join(', ')}
                        {(() => {
                          const m = pflow === 'import' ? euMeasureOn(measures, hs6, s.geo) : measureAgainstEU(measures, hs6, s.geo)
                          return m && <span title={`${m.duty || ''} ${m.case_ref || ''}`} style={tdTag}>{shortLabel(m)}</span>
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 6 }}>
                Screening table in tonnes and €/t whatever the toggle shows (the detector's floors are tonnage). Top 12 partners by the latest month; ratios in red exceed the screening thresholds; a flag means the detector fired on that partner within the last three months.
              </div>
            </div>
            </details>
          </>
        ) : partners ? <EmptyState>No partner rows for this product and flow.</EmptyState>
          : <EmptyState>Loading…</EmptyState>}
      </Card>

      <CompetitorExports hs6={hs6} productLabel={productLabel} fromDate={fromDate} basis={basis} measures={measures} />

      <TradeDefence hs6={hs6} measures={measures} />

      <DependencyDetail product={product} productLabel={productLabel} />
    </>
  )
}
