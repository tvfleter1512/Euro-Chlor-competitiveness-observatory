// Shared chart chrome: card, provenance chips, legend, empty state, tooltip.
import React, { useState } from 'react'

// Provenance chips (spec §8: every figure carries source + retrieved date).
export function SourceChips({ rows, theme }) {
  const [open, setOpen] = useState(false)
  if (!rows?.length) return null
  const seen = new Map()
  for (const r of rows) {
    const key = `${r.source}|${r.source_dataset}`
    if (!seen.has(key)) seen.set(key, { ...r, estimated: false })
    if (r.quality_flag === 'estimated') seen.get(key).estimated = true
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen(!open)} style={{
        background: 'none', border: `1px solid ${theme.border}`, borderRadius: 12,
        color: theme.inkMuted, fontSize: 11, padding: '2px 10px', cursor: 'pointer',
      }}>
        {open ? '▾' : '▸'} Sources ({seen.size})
      </button>
      {open && [...seen.values()].map((s, i) => (
        <div key={i} style={{ fontSize: 11, color: theme.inkSecondary, marginTop: 4 }}>
          <strong>{s.source}</strong> — {s.source_dataset} · retrieved{' '}
          {String(s.retrieved_at).slice(0, 10)}
          {s.estimated && <span style={{ color: theme.status.serious }}> · ⚠ includes estimated values</span>}
        </div>
      ))}
    </div>
  )
}

export function ChartCard({ title, subtitle, children, theme, sourceRows }) {
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 8, padding: '16px 20px 12px', marginBottom: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: theme.ink }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: theme.inkSecondary, marginTop: 2 }}>{subtitle}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
      <SourceChips rows={sourceRows} theme={theme} />
    </div>
  )
}

export function EmptyState({ theme, children }) {
  return (
    <div style={{
      padding: '32px 16px', textAlign: 'center', fontSize: 13,
      color: theme.inkMuted, border: `1px dashed ${theme.grid}`, borderRadius: 6,
    }}>{children}</div>
  )
}

// Legend: colored key beside text in ink (text never wears the series color).
export function Legend({ items, theme }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
      {items.map(({ label, color }) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: theme.inkSecondary }}>
          <span style={{ width: 12, height: 3, background: color, borderRadius: 2 }} />
          {label}
        </span>
      ))}
    </div>
  )
}

export function makeTooltip(theme, formatter) {
  return function CustomTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 6,
        padding: '8px 12px', fontSize: 12, color: theme.ink, boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.filter(p => p.value != null).map((p) => (
          <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: p.color || p.fill }} />
            <span style={{ color: theme.inkSecondary }}>{p.name}:</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatter(p.value)}</span>
          </div>
        ))}
      </div>
    )
  }
}
