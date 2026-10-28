// Trade-defence measures on the basket products (config/trade_defence.yaml):
// who protects their market against whom. Context for the trade alerts.
import React, { useEffect, useState } from 'react'
import { fetchTradeDefenceSignals } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import { Card, EmptyState, Segmented } from '../components'
import { isLive } from '../tdlinks'

const LIVE = ['initiated', 'provisional', 'definitive', 'extended', 'expiry_review']
const STAGE = {
  initiated: 'investigation opened', provisional: 'provisional duty', definitive: 'definitive duty',
  extended: 'extended', expiry_review: 'expiry review', expired: 'expired', terminated: 'terminated',
  not_imposed: 'recommended, not imposed',
}
const INSTRUMENT = { anti_dumping: 'anti-dumping', anti_subsidy: 'anti-subsidy', safeguard: 'safeguard' }
const PRODUCT = {
  caustic_soda: 'Caustic soda', chlorine: 'Chlorine', hydrochloric_acid: 'Hydrochloric acid',
  hypochlorite: 'Sodium hypochlorite', sodium_chlorate: 'Sodium chlorate', edc: 'EDC', vcm: 'VCM', pvc: 'PVC',
}
const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const geo = g => {
  if (g === 'ALL') return 'all origins'
  if (g === 'EU' || GEO_LABEL[g]) return GEO_LABEL[g] || 'EU'
  try { return REGION.of(g) } catch { return g }
}

export default function TradeDefence({ hs6, measures }) {
  const theme = useTheme()
  const [scope, setScope] = useState('product')
  const [signals, setSignals] = useState([])

  useEffect(() => {
    fetchTradeDefenceSignals().then(d => setSignals(d.signals)).catch(() => {})
  }, [])

  const all = measures || []
  const live = all.filter(isLive)
  const forProduct = live.filter(m => hs6 && m.hs?.includes(hs6))
  const rows = { product: forProduct, live, all }[scope]
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, color: theme.inkMuted, fontWeight: 700,
               textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${theme.grid}`, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 12.5, color: theme.ink, borderBottom: `1px solid ${theme.grid}`, verticalAlign: 'top' }
  const hitsEU = m => m.targets?.includes('EU') || m.imposing === 'EU'

  return (
    <Card title="Trade-defence measures — anti-dumping, anti-subsidy, safeguards"
      subtitle="Who protects their market against whom: measures in force or under investigation on the selected product, newest first. ✓ = checked against the official notice."
      method="Switch to all products or the full history since 2015; in the wider views the selected product is highlighted. EU-related rows are in bold. The same measures are marked on the trade-flow charts and tagged in the alert and partner tables. Source list: config/trade_defence.yaml, checked against the EU Official Journal, the US Federal Register, the UK Trade Remedies Authority and national gazettes."
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
                const mine = scope !== 'product' && hs6 && m.hs?.includes(hs6)
                return (
                  <tr key={i} title={m.note || ''} style={{ background: mine ? theme.accentSoft : 'transparent',
                                                           fontWeight: hitsEU(m) ? 650 : 400 }}>
                    <td style={td}>{geo(m.imposing)}</td>
                    <td style={td}>{(m.targets || []).map(geo).join(', ')}</td>
                    <td style={td}>{PRODUCT[m.product] || m.product}</td>
                    <td style={{ ...td, color: theme.inkSecondary }}>{INSTRUMENT[m.instrument] || m.instrument}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: isLive(m) ? theme.ink : theme.inkMuted }}>{STAGE[m.stage] || m.stage}{!isLive(m) && LIVE.includes(m.stage) ? ' (lapsed)' : ''}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m.date}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: theme.inkSecondary }}>{m.expires || '—'}</td>
                    <td style={{ ...td, fontSize: 12, maxWidth: 260 }}>{m.duty || '—'}</td>
                    <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {m.confirmed && m.official_url
                        ? <a href={m.official_url} target="_blank" rel="noreferrer" style={{ color: theme.accentText }}
                             title={m.verification_note || ''}>✓ official ↗</a>
                        : m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer" style={{ color: theme.inkSecondary }}
                             title={m.verification_note || 'not yet checked against the official text'}>◐ source ↗</a>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 6 }}>
            ✓ official = checked against the official notice ({all.filter(m => m.confirmed).length} of {all.length}); ◐ = trade press or unverified. Hover a row for notes.
          </div>
        </div>
      ) : <EmptyState>{scope === 'product' ? 'No measure in force or under investigation on this product — see all products.' : 'No measures listed.'}</EmptyState>}
      {signals.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 650, color: theme.ink }}>
            Weekly watch — {signals.length} headline{signals.length > 1 ? 's' : ''} not yet in the list above
          </summary>
          <div style={{ fontSize: 11.5, color: theme.inkMuted, margin: '6px 0' }}>
            Official journals (EU, UK, US) and trade press, scanned every Monday. Some describe a case already listed via another source; real new cases are added to the list after checking.
          </div>
          {signals.map(sg => (
            <div key={sg.signal_id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '5px 0',
                                             borderBottom: `1px solid ${theme.grid}` }}>
              <span style={{ color: theme.inkMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{sg.published || '—'}</span>
              <span style={{ color: theme.inkSecondary, whiteSpace: 'nowrap' }}>{sg.source}</span>
              <a href={sg.url} target="_blank" rel="noreferrer" style={{ color: theme.ink, flex: 1 }}>{sg.title} ↗</a>
            </div>
          ))}
        </details>
      )}
    </Card>
  )
}
