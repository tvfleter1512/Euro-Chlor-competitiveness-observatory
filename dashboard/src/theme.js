// UI chrome: Euro Chlor palette as used on the 17 Connections / Water pages —
// green #3DA434 (darkened to #2F8228 wherever it carries white or small text),
// yellow #FFE500, ink #231F20, greys #6D6E71 / #C9C9C2 / #ECECEC / #F1F2F2.
// Near-black title band. Data series: validated categorical palette (dataviz
// validator, adjacent pairs) with the brand blue #005CAB for the EU, brand
// cyan #04BBEE and orange #F47B20 in slots 7 and 8.
// Categorical hues are fixed per ENTITY, never assigned by rank or cycled.
import { createContext, useContext } from 'react'

export const BRAND = {
  ink: '#231F20', grey: '#6D6E71', greyLight: '#C9C9C2', greyLine: '#ECECEC', greyWash: '#F1F2F2',
  green: '#3DA434', greenDark: '#2F8228', greenWash: '#E9F4E7', yellow: '#FFE500',
  blue: '#005CAB', blueLight: '#579EC6', cyan: '#04BBEE', orange: '#F47B20',
}

export const LIGHT = {
  mode: 'light',
  // UI chrome
  page: BRAND.greyWash, header: '#ffffff', band: BRAND.ink, surface: '#ffffff',
  accent: BRAND.greenDark, accentSoft: BRAND.greenWash, accentText: BRAND.greenDark,
  highlight: BRAND.yellow, highlightText: BRAND.ink,
  ink: BRAND.ink, inkSecondary: '#3F3F3A', inkMuted: BRAND.grey,
  grid: BRAND.greyLine, axis: BRAND.greyLight, border: 'rgba(35,31,32,0.10)',
  shadow: '0 1px 2px rgba(35,31,32,0.04), 0 6px 20px rgba(35,31,32,0.05)',
  good: '#2F8228', bad: '#d03b3b',
  // data series (validated palette, light mode; s1 = EU on brand blue)
  series: { s1: BRAND.blue, s2: '#1baf7a', s3: '#eda100', s4: '#008300',
            s5: '#4a3aa7', s6: '#e34948', s7: BRAND.cyan, s8: BRAND.orange },
  divergingPos: BRAND.blue, divergingNeg: '#e34948',
  status: { good: '#2F8228', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

export const DARK = {
  mode: 'dark',
  page: '#161515', header: '#1f1d1d', band: '#0e0d0d', surface: '#1f1d1d',
  accent: BRAND.greenDark, accentSoft: 'rgba(61,164,52,0.16)', accentText: '#6cc463',
  highlight: BRAND.yellow, highlightText: BRAND.ink,
  ink: '#f3f3f1', inkSecondary: '#c4c4bf', inkMuted: '#8f8f8a',
  grid: '#2e2c2c', axis: '#433f3f', border: 'rgba(255,255,255,0.09)',
  shadow: 'none',
  good: '#4cb843', bad: '#e66767',
  series: { s1: '#4f8fd6', s2: '#199e70', s3: '#c98500', s4: '#008300',
            s5: '#9085e9', s6: '#e66767', s7: '#1aa3d1', s8: '#d96a1e' },
  divergingPos: '#4f8fd6', divergingNeg: '#e66767',
  status: { good: '#4cb843', warning: '#fab219', serious: '#ec835a', critical: '#e66767' },
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

// Fixed trade-partner -> slot mapping for the by-origin/destination charts. Slots
// are shared only between partners that do not appear together in the same
// product's top-6 (checked against 12-month tonnage, Sep 2026). Unmapped partners
// fall into 'Other'. Colour follows the partner, never its rank.
export const PARTNER_SLOT = {
  MX: 's1', CH: 's1', TH: 's1',
  US: 's2', RU: 's2',
  CN: 's3', UA: 's3', CA: 's3',
  NO: 's4', DZ: 's4', MA: 's4',
  EG: 's5', TR: 's5', MK: 's5',
  KR: 's6', IN: 's6', BA: 's6',
  GB: 's7', PK: 's7',
  TW: 's8', XS: 's8', AL: 's8', TN: 's8',
}

// Fixed product-key -> slot order (stable across sessions; from basket order)
export const PRODUCT_SLOTS = ['s1', 's2', 's3', 's5', 's6', 's8', 's7', 's4']

export const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const ThemeContext = createContext(LIGHT)
export const useTheme = () => useContext(ThemeContext)
