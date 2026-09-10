// Data series: validated reference palette (dataviz skill, references/palette.md).
// UI chrome: Euro Chlor brand palette (as supplied for the Industry Review site) —
// black #272525, blue-dark #325da7, blue-light #719dc3, yellow #fde62f, plus the
// navy/blue tints derived from it. White cards on a blue-tinted page, navy title band.
// Categorical hues are fixed per ENTITY, never assigned by rank or cycled.
import { createContext, useContext } from 'react'

export const BRAND = {
  black: '#272525', blueDark: '#325da7', blueLight: '#719dc3', yellow: '#fde62f',
  navy: '#1c3260', blueMid: '#4a7ac0', bluePale: '#a8c4dc', blueWash: '#eaf1f8', blueTint: '#f5f8fc',
}

export const LIGHT = {
  mode: 'light',
  // UI chrome
  page: BRAND.blueTint, header: '#ffffff', band: BRAND.navy, surface: '#ffffff',
  accent: BRAND.blueDark, accentSoft: BRAND.blueWash, accentText: BRAND.blueDark,
  highlight: BRAND.yellow, highlightText: BRAND.navy,
  ink: BRAND.black, inkSecondary: '#4f4c4c', inkMuted: '#7d7a7a',
  grid: '#e8e6e6', axis: '#d6d3d3', border: 'rgba(39,37,37,0.10)',
  shadow: '0 1px 2px rgba(28,50,96,0.04), 0 6px 20px rgba(28,50,96,0.06)',
  good: '#0ca30c', bad: '#d03b3b',
  // data series (validated palette, light mode; s1 = EU on brand blue)
  series: { s1: '#325da7', s2: '#1baf7a', s3: '#eda100', s4: '#008300',
            s5: '#4a3aa7', s6: '#e34948', s7: '#e87ba4', s8: '#eb6834' },
  divergingPos: '#325da7', divergingNeg: '#e34948',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

export const DARK = {
  mode: 'dark',
  page: '#0f1626', header: '#161f33', band: '#141c2f', surface: '#1a2338',
  accent: BRAND.blueLight, accentSoft: 'rgba(113,157,195,0.16)', accentText: BRAND.bluePale,
  highlight: BRAND.yellow, highlightText: BRAND.navy,
  ink: '#f2f4f8', inkSecondary: '#b9c2d0', inkMuted: '#7f8a9c',
  grid: '#2a3348', axis: '#374158', border: 'rgba(255,255,255,0.09)',
  shadow: 'none',
  good: '#0ca30c', bad: '#e66767',
  series: { s1: '#719dc3', s2: '#199e70', s3: '#c98500', s4: '#008300',
            s5: '#9085e9', s6: '#e66767', s7: '#d55181', s8: '#d95926' },
  divergingPos: '#719dc3', divergingNeg: '#e66767',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

// Fixed entity -> categorical slot mapping (color follows the entity)
export const GEO_SLOT = {
  EU27_2020: 's1', US: 's2', CN: 's3', GULF: 's4', IN: 's5',
  DE: 's2', FR: 's3', NL: 's4', BE: 's5', ES: 's6', IT: 's7', PL: 's8',
  DE_LU: 's2',   // ENTSO-E bidding zone; same entity colour as Germany
}

export const GEO_LABEL = {
  EU27_2020: 'EU27', US: 'United States', CN: 'China', GULF: 'Gulf (GCC)', IN: 'India',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', BE: 'Belgium',
  ES: 'Spain', IT: 'Italy', PL: 'Poland', EXTRA_EU: 'Extra-EU', WORLD: 'World',
  DE_LU: 'Germany-Luxembourg',
}

// Fixed product-key -> slot order (stable across sessions; from basket order)
export const PRODUCT_SLOTS = ['s1', 's2', 's3', 's5', 's6', 's8', 's7', 's4']

export const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const ThemeContext = createContext(LIGHT)
export const useTheme = () => useContext(ThemeContext)
