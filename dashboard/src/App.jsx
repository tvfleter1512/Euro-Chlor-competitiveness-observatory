import React, { useEffect, useState } from 'react'
import { LIGHT, DARK, ThemeContext, FONT } from './theme'
import { fetchProducts, fetchMode, fetchAlerts } from './api'
import { groupAlerts } from './alerts'
import Header from './Header'
import Overview from './tabs/Overview'
import Costs from './tabs/Costs'
import Trade from './tabs/Trade'
import Dependency from './tabs/Dependency'
import Market from './tabs/Market'
import Members from './tabs/Members'
import Sources from './tabs/Sources'

const TITLE = {
  Overview: 'Overview', Costs: 'Costs', Trade: 'Trade & dependency', Market: 'Market',
  Members: 'Member data', Sources: 'Sources',
}

const SUBTITLE = {
  Overview: 'Headline indicators, the latest trade alerts and capacity events',
  Costs: 'Electricity, gas and carbon, and the full cost of a tonne of chlorine and caustic soda',
  Trade: 'Extra-EU trade in the chlor-alkali product basket and import dependency',
  Market: 'Production, operating rates, prices, customer industries and capacity events',
  Members: 'Euro Chlor member survey data — restricted',
  Sources: 'Source health, product basket and reference library',
}

const NO_RANGE_TABS = ['Overview', 'Sources']   // tabs whose content ignores the date range

const RANGES = [
  { label: 'Since 2015', from: '2015-01-01' },
  { label: 'Since 2020', from: '2020-01-01' },
  { label: 'Since 2022', from: '2022-01-01' },
]

export default function App() {
  const [dark, setDark] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = dark ? DARK : LIGHT
  const [tab, setTab] = useState('Overview')
  const [range, setRange] = useState(RANGES[0])
  const [basket, setBasket] = useState([])
  const [product, setProduct] = useState(null)
  const [basis, setBasis] = useState('value')   // Trade tab: € value vs tonnage
  const [memberMode, setMemberMode] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    fetchMode().then(m => setMemberMode(!!m.member_mode)).catch(() => {})
    // open trade signals, grouped exactly as the Trade tab and Overview list them
    fetchAlerts(6).then(d => setAlertCount(groupAlerts(d.rows).length)).catch(() => {})
    fetchProducts().then(p => {
      const cn8 = p.products.filter(x => x.nomenclature === 'CN8')
      setBasket(cn8)
      setProduct((cn8.find(x => x.product_code === '28151200') || cn8[0])?.product_code)
    }).catch(() => {})
  }, [])

  const openTab = (t) => { setTab(t); window.scrollTo({ top: 0 }) }

  // Filter controls sit on the dark band: translucent white at rest, brand yellow when active.
  const pill = (active) => ({
    padding: '7px 15px', fontSize: 12.5, cursor: 'pointer', borderRadius: 999,
    border: `1px solid ${active ? theme.highlight : 'rgba(255,255,255,0.28)'}`,
    background: active ? theme.highlight : 'rgba(255,255,255,0.10)',
    color: active ? theme.highlightText : '#fff', fontFamily: FONT, fontWeight: 600,
  })

  const selected = basket.find(b => b.product_code === product)

  const wrap = { maxWidth: 1320, margin: '0 auto', padding: '0 clamp(16px, 3vw, 32px)' }

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ minHeight: '100vh', background: theme.page, fontFamily: FONT,
                    display: 'flex', flexDirection: 'column' }}>
        <Header tab={tab} setTab={openTab} dark={dark} setDark={setDark} memberMode={memberMode}
                alertCount={alertCount} />

        {/* Title band: page title left, the one filter row scoping every chart right */}
        <section style={{ background: theme.band, color: '#fff' }}>
          <div style={{ ...wrap, paddingTop: 30, paddingBottom: 26, display: 'flex', alignItems: 'flex-end',
                        gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em',
                            textTransform: 'uppercase', color: theme.highlight }}>
                EU chlor-alkali competitiveness vs world regions
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15,
                           margin: '6px 0 0', color: '#fff' }}>{TITLE[tab]}</h1>
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.78)', marginTop: 6 }}>
                {SUBTITLE[tab]}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!NO_RANGE_TABS.includes(tab) && RANGES.map(r => (
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
              {tab === 'Trade' && basket.length > 0 && (
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
                       paddingTop: 26, paddingBottom: 40 }}>
          {tab === 'Overview' && <Overview memberMode={memberMode} setTab={openTab} setProduct={setProduct} />}
          {tab === 'Costs' && <Costs fromDate={range.from} memberMode={memberMode} />}
          {tab === 'Trade' && (
            <>
              <Trade fromDate={range.from} product={product} basis={basis} setProduct={setProduct}
                     productLabel={selected?.name || product} confirmed={selected?.confirmed} />
              <Dependency product={product} productLabel={selected?.name || product} setProduct={setProduct} />
            </>
          )}
          {tab === 'Market' && <Market fromDate={range.from} memberMode={memberMode} />}
          {tab === 'Members' && <Members fromDate={range.from} />}
          {tab === 'Sources' && <Sources />}
        </main>

        <footer style={{ borderTop: `1px solid ${theme.border}`, background: theme.header }}>
          <div style={{ ...wrap, paddingTop: 16, paddingBottom: 16, fontSize: 11.5, color: theme.inkMuted,
                        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <span>Euro Chlor Competitiveness Observatory · {memberMode ? 'Member view' : 'Model A — public data only'}</span>
            <span>Provenance-first: figures without a source do not render.</span>
          </div>
        </footer>
      </div>
    </ThemeContext.Provider>
  )
}
