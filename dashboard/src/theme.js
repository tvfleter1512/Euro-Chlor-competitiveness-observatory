// Data series: validated reference palette (dataviz skill, references/palette.md).
// UI chrome: Flup-style admin layout — soft neutral page, white cards, green accent.
// Categorical hues are fixed per ENTITY, never assigned by rank or cycled.
import { createContext, useContext } from 'react'

export const LIGHT = {
  mode: 'light',
  // UI chrome (Flup look)
  page: '#f4f5f4', sidebar: '#ffffff', surface: '#ffffff',
  accent: '#0e4430', accentSoft: '#e3f2ea', accentText: '#0e4430',
  ink: '#12291d', inkSecondary: '#5c6b62', inkMuted: '#93a09a',
  grid: '#eceeec', axis: '#d5dad6', border: 'rgba(18,41,29,0.08)',
  shadow: '0 1px 2px rgba(18,41,29,0.04), 0 8px 24px rgba(18,41,29,0.05)',
  good: '#0ca30c', bad: '#d03b3b',
  // data series (validated palette, light mode)
  series: { s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100', s4: '#008300',
            s5: '#4a3aa7', s6: '#e34948', s7: '#e87ba4', s8: '#eb6834' },
  divergingPos: '#2a78d6', divergingNeg: '#e34948',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

export const DARK = {
  mode: 'dark',
  page: '#0d0d0d', sidebar: '#161715', surface: '#1a1a19',
  accent: '#35b37e', accentSoft: 'rgba(53,179,126,0.14)', accentText: '#7fd6ae',
  ink: '#f2f4f2', inkSecondary: '#b7c0ba', inkMuted: '#7d867f',
  grid: '#2c2c2a', axis: '#383835', border: 'rgba(255,255,255,0.09)',
  shadow: 'none',
  good: '#0ca30c', bad: '#e66767',
  series: { s1: '#3987e5', s2: '#199e70', s3: '#c98500', s4: '#008300',
            s5: '#9085e9', s6: '#e66767', s7: '#d55181', s8: '#d95926' },
  divergingPos: '#3987e5', divergingNeg: '#e66767',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

// Fixed entity -> categorical slot mapping (color follows the entity)
export const GEO_SLOT = {
  EU27_2020: 's1', US: 's2', CN: 's3', GULF: 's4', IN: 's5',
  DE: 's2', FR: 's3', NL: 's4', BE: 's5', ES: 's6', IT: 's7', PL: 's8',
}

export const GEO_LABEL = {
  EU27_2020: 'EU27', US: 'United States', CN: 'China', GULF: 'Gulf (GCC)', IN: 'India',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', BE: 'Belgium',
  ES: 'Spain', IT: 'Italy', PL: 'Poland', EXTRA_EU: 'Extra-EU', WORLD: 'World',
}

// Fixed product-key -> slot order (stable across sessions; from basket order)
export const PRODUCT_SLOTS = ['s1', 's2', 's3', 's5', 's6', 's8', 's7', 's4']

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export const ThemeContext = createContext(LIGHT)
export const useTheme = () => useContext(ThemeContext)
