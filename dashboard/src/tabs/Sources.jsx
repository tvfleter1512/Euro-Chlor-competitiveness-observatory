import React, { useEffect, useState } from 'react'
import { fetchHealth, fetchProducts } from '../api'
import { useTheme } from '../theme'
import { Card, EmptyState } from '../components'

// Status colors ship with icon + label, never color alone (dataviz rule).
const STATUS = {
  success: { icon: '●', role: 'good', label: 'success' },
  partial: { icon: '◐', role: 'warning', label: 'partial' },
  skipped: { icon: '○', role: 'warning', label: 'dormant' },
  failed:  { icon: '✕', role: 'critical', label: 'failed' },
  running: { icon: '◌', role: 'warning', label: 'running' },
}

export default function Sources() {
  const theme = useTheme()
  const [health, setHealth] = useState(null)
  const [products, setProducts] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([fetchHealth(), fetchProducts()])
      .then(([h, p]) => { setHealth(h.agents); setProducts(p.products) })
      .catch(e => setError(String(e)))
  }, [])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!health) return <EmptyState>Loading…</EmptyState>

  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: theme.inkMuted,
               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
               borderBottom: `1px solid ${theme.grid}` }
  const td = { padding: '9px 12px', fontSize: 13, color: theme.ink,
               borderBottom: `1px solid ${theme.grid}` }

  return (
    <>
      <Card title="Source health"
        subtitle="Each source is isolated — a broken source marks its own metrics stale, never the observatory.">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={th}>Agent</th><th style={th}>Status</th><th style={th}>Last run</th>
            <th style={th}>Rows</th><th style={th}>Quarantined</th><th style={th}>Notes</th>
          </tr></thead>
          <tbody>
            {health.map(a => {
              const s = STATUS[a.status] || STATUS.running
              return (
                <tr key={a.agent}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{a.agent}</td>
                  <td style={td}>
                    <span style={{ color: theme.status[s.role], marginRight: 6 }}>{s.icon}</span>
                    {s.label}
                  </td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                    {a.started_at ? String(a.started_at).slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{a.rows_ingested}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{a.rows_quarantined}</td>
                  <td style={{ ...td, fontSize: 11, color: theme.inkSecondary, maxWidth: 360,
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.notes || ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Product basket — code confirmation"
        subtitle="Codes are configuration, surfaced for review (spec §3.5). Verify against current CN8/HS nomenclature in config/product_basket.yaml.">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={th}>Code</th><th style={th}>Nomenclature</th>
            <th style={th}>Product</th><th style={th}>Confirmed</th>
          </tr></thead>
          <tbody>
            {(products || []).map(p => (
              <tr key={p.product_code}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{p.product_code}</td>
                <td style={td}>{p.nomenclature}</td>
                <td style={td}>{p.name}</td>
                <td style={td}>
                  {p.confirmed
                    ? <span><span style={{ color: theme.status.good, marginRight: 6 }}>●</span>confirmed</span>
                    : <span><span style={{ color: theme.status.warning, marginRight: 6 }}>◐</span>pending review</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
