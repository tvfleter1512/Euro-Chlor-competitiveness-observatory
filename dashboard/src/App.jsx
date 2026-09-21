import React, { useEffect, useState } from 'react'
import { LIGHT, DARK, ThemeContext, FONT } from './theme'
import { fetchSeries, fetchIndicators, fetchHealth, fetchProducts, fetchMode, fetchAlerts } from './api'
import { StatTile } from './components'
import Header from './Header'
import Electricity from './tabs/Electricity'
import Trade from './tabs/Trade'
import Dependency from './tabs/Dependency'
import Industry from './tabs/Industry'
import Members from './tabs/Members'
import Sources from './tabs/Sources'

const PRODUCT_TABS = ['Trade', 'Dependency']
const OWN_KPI_TABS = ['Trade', 'Dependency', 'Industry']   // tabs with their own tile row

const SUBTITLE = {
  Electricity: 'Delivered and wholesale power prices, EU versus comparator regions',
  Trade: 'Extra-EU trade in the chlor-alkali product basket',
  Dependency: 'Import dependency and disruption risk, Commission CDI method',
  Industry: 'Production, utilisation, prices and margin proxies',
  Members: 'Euro Chlor member survey data — restricted',
  Sources: 'Source health, product basket and reference library',
}

const RANGES = [
  { label: 'Since 2015', from: '2015-01-01' },
  { label: 'Since 2020', from: '2020-01-01' },
  { label: 'Since 2022', from: '2022-01-01' },
]

const fmtM = (v) => `${(v / 1e6).toLocaleString('en', { maximumFractionDigits: 0 })} M€`

export default function App() {
  const [dark, setDark] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = dark ? DARK : LIGHT
  const [tab, setTab] = useState('Electricity')
  const [range, setRange] = useState(RANGES[0])
  const [basket, setBasket] = useState([])
  const [product, setProduct] = useState(null)
  const [basis, setBasis] = useState('value')   // Trade tab: € value vs tonnage
  const [memberMode, setMemberMode] = useState(false)
  const [kpi, setKpi] = useState({})
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    fetchMode().then(m => setMemberMode(!!m.member_mode)).catch(() => {})
    // open trade-surge signals: one per product/flow/partner (same grouping as the Trade tab)
    fetchAlerts(6).then(d => setAlertCount(
      new Set(d.rows.map(a => `${a.product_code}|${a.flow}|${a.partner_geo_id}`)).size)).catch(() => {})
    fetchProducts().then(p => {
      const cn8 = p.products.filter(x => x.nomenclature === 'CN8')
      setBasket(cn8)
      setProduct((cn8.find(x => x.product_code === '28151200') || cn8[0])?.product_code)
    }).catch(() => {})

    Promise.all([
      fetchSeries({ series_id: 'power.industrial_delivered', geo: 'EU27_2020',
                    band: 'MWH_GE150000', tax: 'X_VAT' }),
      fetchIndicators({ indicator_id: 'electricity_cost_ratio', comparator: 'US' }),
      fetchIndicators({ indicator_id: 'trade_balance' }),
      fetchHealth(),
    ]).then(([power, ratio, balance, health]) => {
      const p = power.rows, r = ratio.rows
      const months = [...new Set(balance.rows.map(b => b.period))].sort()
      const last12 = new Set(months.slice(-12)), prev12 = new Set(months.slice(-24, -12))
      const sum = (set) => balance.rows.filter(b => set.has(b.period))
                                       .reduce((a, b) => a + Number(b.value), 0)
      const [bal, balPrev] = [sum(last12), sum(prev12)]
      setKpi({
        power: p.length ? {
          value: `${Number(p[p.length - 1].value).toFixed(0)} €/MWh`,
          period: p[p.length - 1].period,
          delta: p.length > 1
            ? (Number(p[p.length - 1].value) / Number(p[p.length - 2].value) - 1) * 100 : null,
        } : null,
        ratio: r.length ? {
          value: `${Number(r[r.length - 1].value).toFixed(2)}×`,
          period: r[r.length - 1].period,
          delta: r.length > 1
            ? (Number(r[r.length - 1].value) / Number(r[r.length - 2].value) - 1) * 100 : null,
        } : null,
        balance: months.length ? { value: fmtM(bal), delta: balPrev ? (bal - balPrev) / Math.abs(balPrev) * 100 : null } : null,
        sources: health.agents ? {
          live: health.agents.filter(a => ['success', 'partial'].includes(a.status)).length,
          total: health.agents.length,
        } : null,
      })
    }).catch(() => {})
  }, [])

  // Filter controls sit on the navy band: translucent white at rest, brand yellow when active.
  const pill = (active) => ({
    padding: '7px 15px', fontSize: 12.5, cursor: 'pointer', borderRadius: 999,
    border: `1px solid ${active ? theme.highlight : 'rgba(255,255,255,0.28)'}`,
    background: active ? theme.highlight : 'rgba(255,255,255,0.10)',
    color: active ? theme.highlightText : '#fff', fontFamily: FONT, fontWeight: 600,
  })

  const selected = basket.find(b => b.product_code === product)
  const pct = (d) => d == null ? null : `${d >= 0 ? '' : '-'}${Math.abs(d).toFixed(1)} %`

  const wrap = { maxWidth: 1320, margin: '0 auto', padding: '0 32px' }

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ minHeight: '100vh', background: theme.page, fontFamily: FONT,
                    display: 'flex', flexDirection: 'column' }}>
        <Header tab={tab} setTab={setTab} dark={dark} setDark={setDark} memberMode={memberMode}
                alertCount={alertCount} />

        {/* Title band: page title left, the one filter row scoping every chart right */}
        <section style={{ background: theme.band, color: '#fff' }}>
          <div style={{ ...wrap, padding: '30px 32px 26px', display: 'flex', alignItems: 'flex-end',
                        gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em',
                            textTransform: 'uppercase', color: theme.highlight }}>
                EU chlor-alkali competitiveness vs world regions
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15,
                           margin: '6px 0 0', color: '#fff' }}>{tab}</h1>
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.78)', marginTop: 6 }}>
                {SUBTITLE[tab]}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {RANGES.map(r => (
                <button key={r.label} style={pill(range.label === r.label)}
                        onClick={() => setRange(r)}>{r.label}</button>
              ))}
              {tab === 'Trade' && (
                <span style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999,
                               background: 'rgba(255,255,255,0.10)',
                               border: '1px solid rgba(255,255,255,0.28)' }}>
                  {[['value', '€ value'], ['volume', 'tonnes']].map(([key, label]) => (
                    <button key={key} onClick={() => setBasis(key)} style={{
                      padding: '4px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 999,
                      border: 'none', fontFamily: FONT, fontWeight: 600,
                      background: basis === key ? theme.highlight : 'transparent',
                      color: basis === key ? theme.highlightText : '#fff',
                    }}>{label}</button>
                  ))}
                </span>
              )}
              {PRODUCT_TABS.includes(tab) && basket.length > 0 && (
                <select value={product || ''} onChange={e => setProduct(e.target.value)}
                  style={{ padding: '7px 12px', fontSize: 12.5, fontFamily: FONT,
                           background: 'rgba(255,255,255,0.10)', color: '#fff', fontWeight: 600,
                           border: '1px solid rgba(255,255,255,0.28)', borderRadius: 999 }}>
                  {basket.map(b => (
                    <option key={b.product_code} value={b.product_code}
                            style={{ color: theme.ink, background: theme.surface }}>
                      {b.name} ({b.product_code})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </section>

        <main style={{ ...wrap, flex: 1, width: '100%', boxSizing: 'border-box',
                       padding: '26px 32px 40px' }}>
          {!OWN_KPI_TABS.includes(tab) && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <StatTile icon="⚡" label="EU delivered power price"
                value={kpi.power?.value} note={kpi.power?.period}
                delta={pct(kpi.power?.delta)} deltaGood={kpi.power?.delta < 0} />
              <StatTile icon="↔" label="EU ÷ US electricity ratio"
                value={kpi.ratio?.value} note={kpi.ratio?.period}
                delta={pct(kpi.ratio?.delta)} deltaGood={kpi.ratio?.delta < 0} />
              <StatTile icon="🚢" label="Trade balance, basket"
                value={kpi.balance?.value} note="last 12 months, extra-EU"
                delta={pct(kpi.balance?.delta)} deltaGood={kpi.balance?.delta >= 0} />
              <StatTile icon="◉" label="Data sources live"
                value={kpi.sources ? `${kpi.sources.live} / ${kpi.sources.total}` : null}
                note="agents reporting fresh data" />
            </div>
          )}

          {tab === 'Electricity' && <Electricity fromDate={range.from} />}
          {tab === 'Trade' && (
            <Trade fromDate={range.from} product={product} basis={basis} setProduct={setProduct}
                   productLabel={selected?.name || product} confirmed={selected?.confirmed} />
          )}
          {tab === 'Dependency' && (
            <Dependency product={product} productLabel={selected?.name || product} />
          )}
          {tab === 'Industry' && <Industry fromDate={range.from} />}
          {tab === 'Members' && <Members fromDate={range.from} />}
          {tab === 'Sources' && <Sources />}
        </main>

        <footer style={{ borderTop: `1px solid ${theme.border}`, background: theme.header }}>
          <div style={{ ...wrap, padding: '16px 32px', fontSize: 11.5, color: theme.inkMuted,
                        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <span>Euro Chlor Competitiveness Observatory · {memberMode ? 'Member view' : 'Model A — public data only'}</span>
            <span>Provenance-first: figures without a source do not render.</span>
          </div>
        </footer>
      </div>
    </ThemeContext.Provider>
  )
}
