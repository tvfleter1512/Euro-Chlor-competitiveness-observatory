// Shared chrome: cards, stat tiles, legend, provenance chips, empty states.
import React, { useState } from 'react'
import { useTheme, FONT } from './theme'

// method: optional 'How calculated' text, folded away so the subtitle stays one plain line
export function Card({ title, subtitle, method, children, sourceRows, right }) {
  const theme = useTheme()
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 12, padding: '20px clamp(14px, 2.5vw, 24px) 14px', boxShadow: theme.shadow,
      marginBottom: 20,
    }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: theme.ink }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: theme.inkSecondary, marginTop: 3 }}>{subtitle}</div>}
          </div>
          {right}
        </div>
      )}
      {method && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: theme.inkMuted, fontWeight: 600 }}>How calculated</summary>
          <div style={{ fontSize: 11.5, color: theme.inkSecondary, marginTop: 4, lineHeight: 1.5, maxWidth: 900 }}>{method}</div>
        </details>
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
// spark: optional array of numbers, drawn as a small trend line under the value
export function StatTile({ label, value, delta, deltaGood, icon, note, spark, onClick }) {
  const theme = useTheme()
  // arrow = direction, colour = good/bad; no change is neutral grey
  const flat = delta != null && /^-?0(\.0+)?\s/.test(delta)
  const deltaColor = delta == null || flat ? theme.inkMuted : deltaGood ? theme.good : theme.bad
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 12, padding: '16px 20px', boxShadow: theme.shadow, flex: 1, minWidth: 190,
      cursor: onClick ? 'pointer' : 'default',
    }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, background: theme.highlight,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: theme.highlightText, fontSize: 13,
        }}>{icon}</span>
        <span style={{ fontSize: 12.5, color: theme.inkSecondary }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: theme.ink }}>{value ?? '—'}</span>
        {delta != null && (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: deltaColor }}>
            {flat ? '→' : delta.startsWith('-') ? '↘' : '↗'} {delta.replace('-', '')}
          </span>
        )}
      </div>
      {note && <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 4 }}>{note}</div>}
      {spark?.length > 1 && <Sparkline values={spark} />}
    </div>
  )
}

function Sparkline({ values, height = 30 }) {
  const theme = useTheme()
  const v = values.filter(x => x != null && Number.isFinite(x))
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const pts = v.map((x, i) => `${(i / (v.length - 1) * 100).toFixed(2)},${(height - 3 - (x - lo) / span * (height - 6)).toFixed(2)}`)
  const [lx, ly] = pts.at(-1).split(',')
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height}
         style={{ display: 'block', marginTop: 8, overflow: 'visible' }} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={theme.series.s1} strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2" fill={theme.series.s1} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Two-to-four option pill switch inside a card header (e.g. tonnes | utilisation)
export function Segmented({ options, value, onChange }) {
  const theme = useTheme()
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, padding: 3, borderRadius: 16, maxWidth: '100%',
                   background: theme.page, border: `1px solid ${theme.border}` }}>
      {options.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} style={{
          padding: '3px 11px', fontSize: 11.5, cursor: 'pointer', borderRadius: 999,
          border: 'none', fontWeight: 600, fontFamily: FONT,
          background: value === key ? theme.accent : 'transparent',
          color: value === key ? '#fff' : theme.inkSecondary,
        }}>{label}</button>
      ))}
    </span>
  )
}

// Heading that opens a group of cards within a tab
export function SectionHeading({ title, subtitle, right }) {
  const theme = useTheme()
  return (
    <div style={{ margin: '12px 0 14px', paddingLeft: 12, borderLeft: `3px solid ${theme.highlight}`,
                  display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: 19, fontWeight: 750, color: theme.ink, letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: theme.inkSecondary, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

// One-line written takeaway at the top of a tab or section
export function Headline({ children }) {
  const theme = useTheme()
  if (!children) return null
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderLeft: `4px solid ${theme.accent}`,
                  borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 14, lineHeight: 1.55,
                  color: theme.ink, boxShadow: theme.shadow }}>{children}</div>
  )
}

export const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 20 }

export function Legend({ items }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {items.map(({ label, color, dashed }) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: theme.inkSecondary }}>
          <span style={{ width: 12, height: 3, borderRadius: 2,
                         background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 6px)` : color }} />
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
