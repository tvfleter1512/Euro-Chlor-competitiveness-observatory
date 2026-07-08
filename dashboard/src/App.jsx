import React, { useEffect, useState } from 'react'
import { useTheme } from './theme'
import { fetchProducts } from './api'
import Electricity from './tabs/Electricity'
import Trade from './tabs/Trade'
import Sources from './tabs/Sources'

const TABS = ['Electricity', 'Trade', 'Sources']
const RANGES = [
  { label: 'Since 2015', from: '2015-01-01' },
  { label: 'Since 2020', from: '2020-01-01' },
  { label: 'Since 2022', from: '2022-01-01' },
]

export default function App() {
  const theme = useTheme()
  const [tab, setTab] = useState('Electricity')
  const [range, setRange] = useState(RANGES[0])
  const [basket, setBasket] = useState([])
  const [product, setProduct] = useState(null)

  useEffect(() => {
    fetchProducts().then(p => {
      const cn8 = p.products.filter(x => x.nomenclature === 'CN8')
      setBasket(cn8)
      const caustic = cn8.find(x => x.product_code === '28151200')
      setProduct((caustic || cn8[0])?.product_code)
    }).catch(() => {})
  }, [])

  const selected = basket.find(b => b.product_code === product)
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif'
  const pill = (active) => ({
    padding: '6px 14px', fontSize: 13, cursor: 'pointer', borderRadius: 16,
    border: `1px solid ${active ? theme.ink : theme.border}`,
    background: active ? theme.ink : 'transparent',
    color: active ? theme.page : theme.inkSecondary, fontFamily: font,
  })

  return (
    <div style={{ minHeight: '100vh', background: theme.page, fontFamily: font }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, color: theme.ink, margin: 0 }}>
            European Chlor-Alkali Competitiveness Observatory
          </h1>
          <div style={{ fontSize: 13, color: theme.inkSecondary, marginTop: 4 }}>
            EU vs world regions — trade, electricity, production, carbon. Every figure carries its source.
          </div>
        </header>

        <nav style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TABS.map(t => (
            <button key={t} style={pill(tab === t)} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>

        {/* single filter row scoping every chart below it */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <button key={r.label} style={pill(range.label === r.label)} onClick={() => setRange(r)}>
              {r.label}
            </button>
          ))}
          {tab === 'Trade' && basket.length > 0 && (
            <select value={product || ''} onChange={e => setProduct(e.target.value)}
              style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 13, fontFamily: font,
                       background: theme.surface, color: theme.ink,
                       border: `1px solid ${theme.border}`, borderRadius: 6 }}>
              {basket.map(b => (
                <option key={b.product_code} value={b.product_code}>
                  {b.name} ({b.product_code})
                </option>
              ))}
            </select>
          )}
        </div>

        {tab === 'Electricity' && <Electricity theme={theme} fromDate={range.from} />}
        {tab === 'Trade' && (
          <Trade theme={theme} fromDate={range.from} product={product}
                 productLabel={selected?.name || product}
                 confirmed={selected?.confirmed} />
        )}
        {tab === 'Sources' && <Sources theme={theme} />}

        <footer style={{ fontSize: 11, color: theme.inkMuted, marginTop: 24 }}>
          Model A: public data only. Provenance-first — figures without a source do not render.
        </footer>
      </div>
    </div>
  )
}
