// Trade-defence measures (config/trade_defence.yaml) placed on the trade data:
// dated markers on monthly charts and flags on partners/alerts.
export const LIVE_STAGES = ['initiated', 'provisional', 'definitive', 'extended', 'expiry_review']
const STAGE_SHORT = {
  initiated: 'investigation', provisional: 'provisional duty', definitive: 'duty',
  extended: 'duty extended', expiry_review: 'expiry review', expired: 'expired', terminated: 'terminated',
  not_imposed: 'not imposed',
}
const INSTR_SHORT = { anti_dumping: 'AD', anti_subsidy: 'CVD', safeguard: 'safeguard' }

// EU member states: a measure 'on EU' imports hits exports from any of them
export const EU27 = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])

export const forProduct = (measures, hs6) => (measures || []).filter(m => hs6 && m.hs?.includes(hs6))
const TODAY = new Date().toISOString().slice(0, 10)
// live = open or in force: a live stage whose expiry (if any) has not passed, except
// expiry reviews, which keep the duty in force beyond the nominal date
export const isLive = m => LIVE_STAGES.includes(m.stage)
  && (m.stage === 'expiry_review' || !m.expires || String(m.expires) >= TODAY)
export const shortLabel = m => `${m.imposing} ${INSTR_SHORT[m.instrument] || m.instrument} ${STAGE_SHORT[m.stage] || m.stage}`

const targets = (m, geo) => m.targets?.includes(geo) || m.targets?.includes('ALL') || (geo === 'EU27_2020' && m.targets?.includes('EU'))
  || (EU27.has(geo) && m.targets?.includes('EU'))

// live EU measure on imports of this product from this partner
export const euMeasureOn = (measures, hs6, partner) =>
  forProduct(measures, hs6).find(m => m.imposing === 'EU' && isLive(m) && targets(m, partner))

// live measure by a destination country on EU exports of this product
export const measureAgainstEU = (measures, hs6, destination) =>
  forProduct(measures, hs6).find(m => m.imposing === destination && isLive(m) && m.targets?.includes('EU'))

// ECharts vertical markers at measure dates that fall within a monthly x-axis.
// compact: imposing-country code only (many markers on one chart)
export function markers(list, periods, theme, compact = false) {
  const inRange = new Set(periods)
  const data = list
    .map(m => ({ m, x: String(m.date).slice(0, 7) }))
    .filter(({ x }) => inRange.has(x))
    .map(({ m, x }) => ({
      xAxis: x,
      label: { formatter: compact ? m.imposing : shortLabel(m), color: theme.inkSecondary, fontSize: 10,
               position: compact ? 'end' : 'insideEndTop' },
    }))
  if (!data.length) return []
  return [{
    type: 'line', data: [], silent: true,
    markLine: { symbol: 'none', data, lineStyle: { color: theme.status.serious, type: 'dashed', width: 1 } },
  }]
}
