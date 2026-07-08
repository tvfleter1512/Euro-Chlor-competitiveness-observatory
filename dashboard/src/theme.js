// Validated reference palette (dataviz skill references/palette.md).
// Categorical hues are fixed per ENTITY, never assigned by rank or cycled.
import { useEffect, useState } from 'react'

const LIGHT = {
  surface: '#fcfcfb', page: '#f9f9f7',
  ink: '#0b0b0b', inkSecondary: '#52514e', inkMuted: '#898781',
  grid: '#e1e0d9', axis: '#c3c2b7', border: 'rgba(11,11,11,0.10)',
  series: { s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100', s4: '#008300',
            s5: '#4a3aa7', s6: '#e34948', s7: '#e87ba4', s8: '#eb6834' },
  divergingPos: '#2a78d6', divergingNeg: '#e34948',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

const DARK = {
  surface: '#1a1a19', page: '#0d0d0d',
  ink: '#ffffff', inkSecondary: '#c3c2b7', inkMuted: '#898781',
  grid: '#2c2c2a', axis: '#383835', border: 'rgba(255,255,255,0.10)',
  series: { s1: '#3987e5', s2: '#199e70', s3: '#c98500', s4: '#008300',
            s5: '#9085e9', s6: '#e66767', s7: '#d55181', s8: '#d95926' },
  divergingPos: '#3987e5', divergingNeg: '#e66767',
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
}

// Fixed entity -> categorical slot mapping (color follows the entity, spec rule)
export const GEO_SLOT = {
  EU27_2020: 's1', US: 's2', CN: 's3', GULF: 's4', IN: 's5',
  DE: 's2', FR: 's3', NL: 's4', BE: 's5', ES: 's6', IT: 's7', PL: 's8',
}

export const GEO_LABEL = {
  EU27_2020: 'EU27', US: 'United States', CN: 'China', GULF: 'Gulf (GCC)', IN: 'India',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', BE: 'Belgium',
  ES: 'Spain', IT: 'Italy', PL: 'Poland', EXTRA_EU: 'Extra-EU', WORLD: 'World',
}

export function useTheme() {
  const [dark, setDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e) => setDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return dark ? DARK : LIGHT
}
