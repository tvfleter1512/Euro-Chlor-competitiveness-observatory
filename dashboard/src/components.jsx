// Shared chrome: cards, stat tiles, legend, provenance chips, empty states.
import React, { useState } from 'react'
import { useTheme, FONT } from './theme'

export function Card({ title, subtitle, children, sourceRows, right }) {
  const theme = useTheme()
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 16, padding: '20px 24px 14px', boxShadow: theme.shadow,
      marginBottom: 20,
    }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: theme.ink }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: theme.inkSecondary, marginTop: 3 }}>{subtitle}</div>}
          </div>
          {right}
        </div>
      )}
      <div style={{ marginTop: 14 }}>{children}</div>
      <SourceChips rows={sourceRows} />
    </div>
  )
}

// Provenance chips (spec §8: every figure carries source + retrieved date).
export function SourceChips({ rows }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  if (!rows?.length) return null
  const seen = new Map()
  for (const r of rows) {
    const key = `${r.source}|${r.source_dataset}`
    if (!seen.has(key)) seen.set(key, { ...r, estimated: false })
    if (r.quality_flag === 'estimated') seen.get(key).estimated = true
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen(!open)} style={{
        background: 'none', border: `1px solid ${theme.border}`, borderRadius: 999,
        color: theme.inkMuted, fontSize: 11, padding: '3px 12px', cursor: 'pointer',
        fontFamily: FONT,
      }}>
        {open ? '▾' : '▸'} Sources ({seen.size})
      </button>
      {open && [...seen.values()].map((s, i) => (
        <div key={i} style={{ fontSize: 11, color: theme.inkSecondary, marginTop: 5 }}>
          <strong>{s.source}</strong> — {s.source_dataset} · retrieved{' '}
          {String(s.retrieved_at).slice(0, 10)}
          {s.estimated && <span style={{ color: theme.status.serious }}> · ⚠ includes estimated values</span>}
        </div>
      ))}
    </div>
  )
}

// KPI stat tile (Flup style): icon chip, muted label, big value, signed delta.
export function StatTile({ label, value, delta, deltaGood, icon, note }) {
  const theme = useTheme()
  const deltaColor = delta == null ? theme.inkMuted : deltaGood ? theme.good : theme.bad
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 16, padding: '16px 20px', boxShadow: theme.shadow, flex: 1, minWidth: 190,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, background: theme.accentSoft,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: theme.accentText, fontSize: 13,
        }}>{icon}</span>
        <span style={{ fontSize: 12.5, color: theme.inkSecondary }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: theme.ink }}>{value ?? '—'}</span>
        {delta != null && (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: deltaColor }}>
            {delta.startsWith('-') ? '↘' : '↗'} {delta.replace('-', '')}
          </span>
        )}
      </div>
      {note && <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 4 }}>{note}</div>}
    </div>
  )
}

export function Legend({ items }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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

export function EmptyState({ children }) {
  const theme = useTheme()
  return (
    <div style={{
      padding: '36px 16px', textAlign: 'center', fontSize: 13,
      color: theme.inkMuted, border: `1px dashed ${theme.grid}`, borderRadius: 12,
    }}>{children}</div>
  )
}
