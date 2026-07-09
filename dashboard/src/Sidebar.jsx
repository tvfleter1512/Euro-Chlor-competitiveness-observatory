import React from 'react'
import { useTheme, FONT } from './theme'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
)

const ICONS = {
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  ship: 'M3 9h18v10H3z|M8 9V5h8v4|M3 13h18',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  factory: 'M2 20h20|M4 20V10l5 3v-3l5 3V4h6v16',
  db: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4',
}

export default function Sidebar({ tab, setTab, dark, setDark }) {
  const theme = useTheme()

  const NavItem = ({ id, icon, children }) => {
    const active = tab === id
    return (
      <button onClick={() => setTab(id)} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: active ? theme.accentSoft : 'transparent',
        color: active ? theme.accentText : theme.inkSecondary,
        fontSize: 13.5, fontWeight: active ? 650 : 500, fontFamily: FONT,
        textAlign: 'left',
      }}>
        <Icon d={ICONS[icon]} />{children}
      </button>
    )
  }

  const sectionLabel = {
    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: theme.inkMuted,
    textTransform: 'uppercase', padding: '0 14px', margin: '18px 0 6px',
  }

  return (
    <aside style={{
      width: 232, flexShrink: 0, background: theme.sidebar,
      borderRight: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column',
      padding: '20px 14px', position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px' }}>
        <span style={{
          width: 32, height: 32, borderRadius: 10, background: theme.accent,
          color: '#fff', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 800, fontSize: 15,
        }}>Cl</span>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 750, color: theme.ink, lineHeight: 1.15 }}>
            Euro Chlor
          </div>
          <div style={{ fontSize: 11, color: theme.inkMuted }}>Observatory</div>
        </div>
      </div>

      <div style={sectionLabel}>Competitiveness</div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavItem id="Electricity" icon="bolt">Electricity</NavItem>
        <NavItem id="Trade" icon="ship">Trade</NavItem>
        <NavItem id="Dependency" icon="shield">Dependency (CDI)</NavItem>
        <NavItem id="Industry" icon="factory">Industry &amp; margins</NavItem>
      </nav>

      <div style={sectionLabel}>System</div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavItem id="Sources" icon="db">Sources &amp; provenance</NavItem>
        <button onClick={() => setDark(!dark)} style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: 'transparent', color: theme.inkSecondary,
          fontSize: 13.5, fontWeight: 500, fontFamily: FONT, textAlign: 'left',
        }}>
          <Icon d={dark ? ICONS.sun : ICONS.moon} />
          {dark ? 'Light mode' : 'Dark mode'}
          <span style={{
            marginLeft: 'auto', width: 30, height: 17, borderRadius: 999,
            background: dark ? theme.accent : theme.axis, position: 'relative',
            transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: dark ? 15 : 2, width: 13, height: 13,
              borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
            }} />
          </span>
        </button>
      </nav>

      <div style={{ marginTop: 'auto', padding: '12px 6px 0', fontSize: 11,
                    color: theme.inkMuted, lineHeight: 1.5 }}>
        Model A — public data only.<br />
        Provenance-first: figures without a source do not render.
      </div>
    </aside>
  )
}
