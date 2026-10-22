// Trade-defence measures on the basket products (config/trade_defence.yaml):
// who protects their market against whom. Context for the trade alerts.
import React, { useEffect, useState } from 'react'
import { fetchTradeDefence } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import { Card, EmptyState, Segmented } from '../components'

const LIVE = ['initiated', 'provisional', 'definitive', 'extended', 'expiry_review']
const STAGE = {
  initiated: 'investigation opened', provisional: 'provisional duty', definitive: 'definitive duty',
  extended: 'extended', expiry_review: 'expiry review', expired: 'expired', terminated: 'terminated',
}
const INSTRUMENT = { anti_dumping: 'anti-dumping', anti_subsidy: 'anti-subsidy', safeguard: 'safeguard' }
const PRODUCT = {
  caustic_soda: 'Caustic soda', chlorine: 'Chlorine', hydrochloric_acid: 'Hydrochloric acid',
  hypochlorite: 'Sodium hypochlorite', sodium_chlorate: 'Sodium chlorate', edc: 'EDC', vcm: 'VCM', pvc: 'PVC',
}
const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const geo = g => {
  if (g === 'EU' || GEO_LABEL[g]) return GEO_LABEL[g] || 'EU'
  try { return REGION.of(g) } catch { return g }
}

export default function TradeDefence({ hs6 }) {
  const theme = useTheme()
  const [measures, setMeasures] = useState(null)
  const [scope, setScope] = useState('product')

  useEffect(() => {
    fetchTradeDefence().then(d => setMeasures(d.measures)).catch(() => setMeasures([]))
  }, [])

  const all = measures || []
  const live = all.filter(m => LIVE.includes(m.stage))
  const forProduct = live.filter(m => hs6 && m.hs?.includes(hs6))
  const rows = { product: forProduct, live, all }[scope]
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, color: theme.inkMuted, fontWeight: 700,
               textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${theme.grid}`, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 12.5, color: theme.ink, borderBottom: `1px solid ${theme.grid}`, verticalAlign: 'top' }
  const hitsEU = m => m.targets?.includes('EU') || m.imposing === 'EU'

  return (
    <Card title="Trade-defence measures — anti-dumping, anti-subsidy, safeguards"
      subtitle={`Measures in force or under investigation on the selected product (switch to all products or the full history since 2015), newest first. Rows for the selected product are highlighted; EU-related rows in bold. Compiled Oct 2026 from official notices and trade press — all pending confirmation (see each source).`}
      right={<Segmented value={scope} onChange={setScope}
        options={[['product', `this product (${forProduct.length})`], ['live', `all products, live (${live.length})`], ['all', `history (${all.length})`]]} />}>
      {!measures ? <EmptyState>Loading…</EmptyState> : rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              {['Imposed by', 'On imports from', 'Product', 'Instrument', 'Stage', 'Since', 'Expires', 'Duty', ''].map(h =>
                <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((m, i) => {
                const mine = hs6 && m.hs?.includes(hs6)
                return (
                  <tr key={i} title={m.note || ''} style={{ background: mine ? theme.accentSoft : 'transparent',
                                                           fontWeight: hitsEU(m) ? 650 : 400 }}>
                    <td style={td}>{geo(m.imposing)}</td>
                    <td style={td}>{(m.targets || []).map(geo).join(', ')}</td>
                    <td style={td}>{PRODUCT[m.product] || m.product}</td>
                    <td style={{ ...td, color: theme.inkSecondary }}>{INSTRUMENT[m.instrument] || m.instrument}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: LIVE.includes(m.stage) ? theme.ink : theme.inkMuted }}>{STAGE[m.stage] || m.stage}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m.date}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: theme.inkSecondary }}>{m.expires || '—'}</td>
                    <td style={{ ...td, fontSize: 12, maxWidth: 260 }}>{m.duty || '—'}</td>
                    <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer" style={{ color: theme.accentText }}>source ↗</a>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 6 }}>Hover a row for the case reference notes.</div>
        </div>
      ) : <EmptyState>{scope === 'product' ? 'No measure in force or under investigation on this product — see all products.' : 'No measures listed.'}</EmptyState>}
    </Card>
  )
}
