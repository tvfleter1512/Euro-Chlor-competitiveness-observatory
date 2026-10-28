// Top header in the Euro Chlor site style: logo lockup left, horizontal navigation right.
import React from 'react'
import { useTheme, FONT } from './theme'

const Icon = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
)

const ICONS = {
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4',
  lock: 'M5 11h14v10H5z|M8 11V7a4 4 0 0 1 8 0v4',
}

const NAV = [
  { id: 'Overview', label: 'Overview' },
  { id: 'Costs', label: 'Costs' },
  { id: 'Trade', label: 'Trade & dependency' },
  { id: 'Market', label: 'Market' },
  { id: 'Members', label: 'Member data', members: true },
  { id: 'Sources', label: 'About the data' },
]

export default function Header({ tab, setTab, dark, setDark, memberMode, alertCount = 0 }) {
  const theme = useTheme()

  return (
    <header style={{
      background: theme.header, borderBottom: `1px solid ${theme.border}`,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{
        maxWidth: 1320, margin: '0 auto', padding: '0 clamp(16px, 3vw, 32px)', minHeight: 66, flexWrap: 'wrap',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <img src={dark ? '/logo-euro-chlor-white.svg' : '/logo-euro-chlor-dark.svg'}
             alt="Euro Chlor" style={{ width: 104, height: 44, display: 'block' }} />
        <span style={{ width: 1, height: 26, background: theme.axis }} />
        <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: theme.inkSecondary,
                       maxWidth: '12ch', letterSpacing: '0.01em' }}>
          Competitiveness <b style={{ display: 'block', color: theme.accentText, fontWeight: 700 }}>Observatory</b>
        </span>

        <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {NAV.filter(n => !n.members || memberMode).map(n => {
            const active = tab === n.id
            return (
              <button key={n.id} onClick={() => setTab(n.id)} style={{
                font: 'inherit', fontFamily: FONT, fontSize: 13.5, fontWeight: active ? 650 : 500,
                color: active ? theme.accentText : theme.inkSecondary,
                background: active ? theme.accentSoft : 'none', border: 0, cursor: 'pointer',
                padding: '8px 11px', borderRadius: 6, whiteSpace: 'nowrap',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                boxShadow: active ? `inset 0 -2px 0 ${theme.highlight}` : 'none',
              }}>
                {n.members && <Icon d={ICONS.lock} size={13} />}
                {n.label}
                {n.id === 'Trade' && alertCount > 0 && (
                  <span title={`${alertCount} open trade alert(s)`} style={{
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                    background: theme.highlight, color: theme.highlightText,
                    fontSize: 11, fontWeight: 800, display: 'inline-grid', placeItems: 'center',
                  }}>{alertCount}</span>
                )}
              </button>
            )
          })}
          <button onClick={() => setDark(!dark)} title={dark ? 'Light mode' : 'Dark mode'} style={{
            marginLeft: 8, width: 36, height: 36, borderRadius: 6, border: `1px solid ${theme.border}`,
            background: 'none', color: theme.inkSecondary, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon d={dark ? ICONS.sun : ICONS.moon} />
          </button>
        </nav>
      </div>
    </header>
  )
}
