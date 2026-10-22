import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchProducts, fetchAlerts, fetchTradePartners } from '../api'
import { useTheme, PRODUCT_SLOTS, PARTNER_SLOT, FONT } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, SectionHeading, StatTile } from '../components'
import { groupAlerts } from '../alerts'

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

const FLOW_LABEL = { import: 'Imports by origin', export: 'Exports by destination' }
const TEST_LABEL = { month: 'latest month', quarter: '3-month average', price: 'unit value' }
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

export default function Trade({ fromDate, product, productLabel, confirmed, basis = 'value', setProduct }) {
  const theme = useTheme()
  const B = BASIS[basis] || BASIS.value
  const [balances, setBalances] = useState(null)   // {value: rows, volume: rows} for product
  const [kpiRows, setKpiRows] = useState(null)     // {qty, val} unfiltered series rows
  const [penetration, setPenetration] = useState(null)
  const [allBalances, setAllBalances] = useState(null)  // {value, volume} all products
  const [basket, setBasket] = useState([])
  const [pflow, setPflow] = useState('import')      // partner section: imports | exports
  const [partners, setPartners] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchProducts().then(p => setBasket(p.basket)).catch(() => {})
    Promise.all([
      fetchIndicators({ indicator_id: 'trade_balance' }),
      fetchIndicators({ indicator_id: 'trade_balance_quantity' }),
    ]).then(([v, q]) => setAllBalances({ value: v.rows, volume: q.rows })).catch(() => {})
    fetchIndicators({ indicator_id: 'import_penetration' })
      .then(d => setPenetration(d.rows)).catch(() => {})
    fetchAlerts(6).then(d => setAlerts(d.rows)).catch(() => {})
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
      xAxis: { ...base.xAxis, data: partners.periods },
      yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: B.axis } },
      tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' }, order: 'seriesDesc',
                 valueFormatter: v => v == null ? '—' : B.fmt(Number(v)) },
      series: [
        ...partners.series.map(s => stack(s.name, s.values, partnerColor(s.geo), false)),
        stack('Other', partners.other, theme.inkMuted, true),
      ],
    }
  }, [partners, theme, basis])

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
      key: b.key, name: b.name, cn8: b.cn8[0], slot: PRODUCT_SLOTS[i % PRODUCT_SLOTS.length],
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

  const alertGroups = useMemo(() => groupAlerts(alerts), [alerts])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!product || !balances || !kpiRows) return <EmptyState>Loading…</EmptyState>

  const unconfirmedNote = confirmed ? '' : ' · ⚠ CN8 code pending human confirmation'
  const maxAbs = ranked ? Math.max(...ranked.items.map(i => Math.abs(i.value)), 1) : 1
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
          <StatTile icon="!" label="Open trade alerts"
            value={String(alertGroups.length)} note="all products, last 6 months" />
        </div>
      )}

      <Card title="Trade alerts — sudden rises by partner"
        subtitle="Screened after every Comext update. Volume: latest month vs the previous 12 (must exceed 2.5× the mean and 1.5× the maximum) or 3-month average vs the previous 12 (1.75×). Price: the partner's unit value (€/t) down 20 % (month) or 15 % (3-month) vs its own previous 12 months. Both need 5 kt and a 10 % share. Thresholds in config/surges.yaml, pending owner confirmation. Click a row to open that product.">
        {alertGroups.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Severity</th>
                <th style={{ ...th, textAlign: 'left' }}>Type</th>
                <th style={{ ...th, textAlign: 'left' }}>Product</th>
                <th style={{ ...th, textAlign: 'left' }}>Flow · partner</th>
                <th style={th}>Period</th><th style={th}>Level</th><th style={th}>vs previous 12 m</th>
                <th style={th}>Share</th><th style={{ ...th, textAlign: 'left' }}>Test</th>
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
                      <td style={{ ...td, textAlign: 'left', color: theme.inkSecondary }}>{KIND_LABEL[a.kind] || a.kind}</td>
                      <td style={{ ...td, textAlign: 'left', fontWeight: mine ? 650 : 500 }}>{a.product_name}</td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        {a.flow === 'import' ? 'from' : 'to'}{' '}
                        {a.partner_geo_id === 'EXTRA_EU' ? 'all extra-EU' : `${a.partner_name} (${a.partner_geo_id})`}
                      </td>
                      <td style={td}>{a.period}{periods.size > 1 ? ` +${periods.size - 1}` : ''}</td>
                      <td style={td}>{a.kind === 'trade_price_drop' ? `${Number(a.value).toFixed(0)} €/t on ${fmtKt(inp.quantity_t)}` : fmtKt(Number(a.value))}</td>
                      <td style={{ ...td, color: a.kind === 'trade_price_drop' ? theme.bad : theme.ink }}>{a.kind === 'trade_price_drop' ? `−${(inp.drop * 100).toFixed(0)} % (${Number(inp.baseline_uv).toFixed(0)} €/t)` : inp.new_origin ? 'new' : x(inp.ratio)}</td>
                      <td style={td}>{inp.share == null ? '—' : `${(inp.share * 100).toFixed(0)} %`}</td>
                      <td style={{ ...td, textAlign: 'left', color: theme.inkSecondary }}>{TEST_LABEL[a.test]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No open alerts in the last 6 months.</EmptyState>}
      </Card>

      <SectionHeading title={`Trade flows — ${productLabel}`}
        subtitle="Who supplies the EU and where it sells, month by month. Change the product in the bar above." />
      <Card sourceRows={flows}
        title={`${FLOW_LABEL[pflow]} — ${productLabel}`}
        subtitle={`Monthly extra-EU ${B.label}, top-6 partners by the last 12 months; the rest as Other.${unconfirmedNote}`}
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
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 6 }}>
                Screening table in tonnes and €/t whatever the toggle shows (the detector's floors are tonnage). Top 12 partners by the latest month; ratios in red exceed the screening thresholds; a flag means the detector fired on that partner within the last three months.
              </div>
            </div>
          </>
        ) : partners ? <EmptyState>No partner rows for this product and flow.</EmptyState>
          : <EmptyState>Loading…</EmptyState>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 20 }}>
        <Card sourceRows={flows}
          title={`Extra-EU trade balance — ${productLabel}`}
          subtitle={`Monthly exports − imports, ${B.label}. Positive = net exporter.${unconfirmedNote}`}>
          {balanceOption ? <EChart option={balanceOption} height={300} theme={theme} />
            : <EmptyState>No balance rows for this product yet.</EmptyState>}
        </Card>

        <Card
          title="Net balance by product"
          subtitle={`Last 12 months, extra-EU, ${B.label} (switch € value / tonnes in the bar above). Click a product to open it.`}>
          {ranked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ranked.items.map(item => (
                <div key={item.key} onClick={() => setProduct?.(item.cn8)}
                     style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                              fontWeight: item.cn8 === product ? 700 : 400 }}>
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
