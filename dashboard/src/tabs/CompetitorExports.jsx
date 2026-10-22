// Where competitors export the selected product: monthly exports of the US,
// India, Saudi Arabia and China (UN Comtrade, plus US Census when keyed),
// split into 'to the EU' and 'rest of world', with the top destinations.
import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import EChart, { baseOption } from '../EChart'
import { Card, EmptyState, Legend, Segmented } from '../components'
import { forProduct, markers } from '../tdlinks'

const REPORTERS = [['US', 'United States'], ['IN', 'India'], ['SA', 'Saudi Arabia'], ['CN', 'China']]
const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const name = g => GEO_LABEL[g] || (() => { try { return REGION.of(g) } catch { return g } })()

export default function CompetitorExports({ hs6, productLabel, fromDate, basis, measures }) {
  const theme = useTheme()
  const [reporter, setReporter] = useState('US')
  const [rows, setRows] = useState(null)
  const volume = basis === 'volume'

  useEffect(() => {
    if (!hs6) return
    setRows(null)
    fetchSeries({ series_id: volume ? 'trade.quantity' : 'trade.value', geo: reporter, product: hs6,
                  flow: 'export', freq: 'M', eur: !volume, from: fromDate })
      .then(d => setRows(d.rows)).catch(() => setRows([]))
  }, [hs6, reporter, volume, fromDate])

  const built = useMemo(() => {
    if (!rows?.length) return null
    const by = (p) => new Map(rows.filter(r => r.partner_geo_id === p).map(r => [r.period, Number(r.value)]))
    const world = by('WORLD'), eu = by('EU27_2020')
    const periods = [...world.keys()].sort()
    if (!periods.length) return null
    const scale = volume ? 1e3 : 1e6
    const toEu = periods.map(p => (eu.get(p) ?? 0) / scale)
    const rest = periods.map((p, i) => Math.max(0, world.get(p) / scale - toEu[i]))
    const last12 = new Set(periods.slice(-12))
    const totals = new Map()
    for (const r of rows) {
      if (!last12.has(r.period) || ['WORLD', 'EU27_2020'].includes(r.partner_geo_id)) continue
      totals.set(r.partner_geo_id, (totals.get(r.partner_geo_id) || 0) + Number(r.value))
    }
    const worldSum = periods.slice(-12).reduce((a, p) => a + world.get(p), 0)
    const euSum = periods.slice(-12).reduce((a, p) => a + (eu.get(p) ?? 0), 0)
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    const base = baseOption(theme)
    const unit = volume ? 'kt' : 'M€'
    const bar = (nm, data, color, last) => ({ name: nm, type: 'bar', stack: 'x', data, barMaxWidth: 22,
      itemStyle: { color, borderColor: theme.surface, borderWidth: 1, borderRadius: last ? [3, 3, 0, 0] : 0 } })
    return {
      latest: periods.at(-1), euShare: worldSum ? euSum / worldSum : null, worldSum, top, unit, scale,
      sources: [...new Set(rows.map(r => r.source))],
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: periods },
        tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' },
                   valueFormatter: v => v == null ? '—' : `${v.toFixed(1)} ${unit}` },
        series: [bar('To the EU27', toEu, theme.series.s1, false), bar('Rest of world', rest, theme.axis, true),
                 // measures any market imposed on this exporter's product (e.g. EU or Brazil duties on US PVC)
                 ...markers(forProduct(measures, hs6).filter(m => m.targets?.includes(reporter)
                   && !['expired', 'terminated'].includes(m.stage)), periods, theme, true)],
      },
    }
  }, [rows, theme, volume, measures, hs6, reporter])

  const td = { padding: '5px 8px', fontSize: 12.5, borderBottom: `1px solid ${theme.grid}`, color: theme.ink }
  return (
    <Card title={`Where competitors export — ${productLabel}`}
      subtitle={`Monthly exports of the selected country, ${volume ? 'tonnes' : '€ (converted from USD at the ECB monthly rate)'}, split into the EU27 and the rest of the world; top destinations over the last 12 months. UN Comtrade${built?.sources.includes('US Census Bureau') ? ' and US Census' : ''}. Dashed markers: trade-defence steps by other markets against this exporter (code of the imposing country; see the table above). Coverage depends on each country's filing: in Oct 2026 the US and India ran to mid-2026, Saudi Arabia lagged a quarter, China stopped at Dec 2024.`}
      sourceRows={rows?.slice(-1)}
      right={<Segmented value={reporter} onChange={setReporter} options={REPORTERS} />}>
      {!rows ? <EmptyState>Loading…</EmptyState> : built ? (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '3 1 480px', minWidth: 0 }}>
            <Legend items={[{ label: 'To the EU27', color: theme.series.s1 }, { label: 'Rest of world', color: theme.axis }]} />
            <EChart option={built.option} height={260} theme={theme} />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ fontSize: 12, color: theme.inkSecondary, marginBottom: 6 }}>
              Last 12 months to {built.latest}: {(built.worldSum / built.scale).toFixed(0)} {built.unit} in total,
              {' '}<strong style={{ color: theme.ink }}>{built.euShare != null ? `${(built.euShare * 100).toFixed(0)} %` : '—'}</strong> to the EU27.
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {built.top.map(([g, v]) => (
                  <tr key={g}>
                    <td style={td}>{name(g)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(v / built.scale).toFixed(1)} {built.unit}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.inkSecondary }}>
                      {(v / built.worldSum * 100).toFixed(0)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <EmptyState>No monthly exports of this product reported by {name(reporter)} in this period.</EmptyState>}
    </Card>
  )
}
