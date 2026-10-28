// Freight cost per tonne on the EU's routes for the selected product, measured
// from trade statistics (indicator freight_cost), above the monthly tonnage on
// the same routes — does trade follow freight?
import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndicators, fetchSeries } from '../api'
import { useTheme, GEO_SLOT } from '../theme'
import EChart, { baseOption, lineSeries, directLabel, yearTicks } from '../EChart'
import { Card, EmptyState, Segmented } from '../components'

const PARTNERS = [['US', 'US'], ['CN', 'China'], ['IN', 'India'], ['SA', 'Saudi Arabia']]
const slot = g => GEO_SLOT[g === 'SA' ? 'GULF' : g]

export default function Freight({ product, productLabel, fromDate }) {
  const theme = useTheme()
  const [dir, setDir] = useState('import')       // into the EU | out of the EU
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!product) return
    setD(null)
    Promise.all([
      fetchIndicators({ indicator_id: 'freight_cost', product }),
      ...PARTNERS.map(([g]) => fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: g,
                                            product, flow: dir, freq: 'M', from: fromDate })),
    ]).then(([f, ...qty]) => setD({ freight: f.rows, qty: qty.map(q => q.rows) }))
      .catch(() => setD({ freight: [], qty: [] }))
  }, [product, dir, fromDate])

  const built = useMemo(() => {
    if (!d?.freight?.length) return null
    const from = (fromDate || '').slice(0, 7)
    const rows = d.freight.filter(r => (dir === 'import' ? r.comparator_geo_id === 'EU27_2020' : r.geo_id === 'EU27_2020')
                                       && r.period >= from)
    if (!rows.length) return null
    const partnerOf = r => dir === 'import' ? r.geo_id : r.comparator_geo_id
    const months = [...new Set([...rows.map(r => r.period),
                                ...d.qty.flat().map(r => r.period)])].filter(m => m >= from).sort()
    const lines = PARTNERS.filter(([g]) => rows.some(r => partnerOf(r) === g))
    const freightBy = g => new Map(rows.filter(r => partnerOf(r) === g).map(r => [r.period, r]))
    const base = baseOption(theme)
    const label = g => PARTNERS.find(p => p[0] === g)[1]
    const route = g => dir === 'import' ? `${label(g)} → EU` : `EU → ${label(g)}`
    const latest = lines.map(([g]) => { const r = [...freightBy(g).values()].at(-1); return r && { g, r } }).filter(Boolean)
    const xAxis = (i, show) => ({ ...yearTicks(base), gridIndex: i, data: months,
                                  axisLabel: { ...yearTicks(base).axisLabel, show, hideOverlap: true } })
    return {
      latest, route,
      option: {
        ...base,
        grid: [{ left: 52, right: 104, top: 16, height: 170 }, { left: 52, right: 104, top: 240, height: 110 }],
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        xAxis: [xAxis(0, false), xAxis(1, true)],
        yAxis: [{ ...base.yAxis, gridIndex: 0, name: '€/t freight', nameTextStyle: { color: theme.inkMuted, fontSize: 10.5 },
                  scale: true },
                { ...base.yAxis, gridIndex: 1, name: 'kt per month', nameTextStyle: { color: theme.inkMuted, fontSize: 10.5 },
                  axisLabel: { ...base.yAxis.axisLabel, formatter: v => (v / 1e3).toFixed(0) } }],
        tooltip: { ...base.tooltip, trigger: 'axis',
                   formatter: ps => {
                     const head = ps[0]?.axisValue || ''
                     return head + ps.map(p => {
                       if (p.value == null) return ''
                       if (p.seriesIndex >= lines.length) return `<br/>${p.marker}${p.seriesName}: ${(p.value / 1e3).toFixed(1)} kt`
                       const r = freightBy(lines[p.seriesIndex][0]).get(head)
                       const share = r?.inputs?.cif_eur_t ? ` (${Math.round(100 * p.value / r.inputs.cif_eur_t)} % of the landed price)` : ''
                       return `<br/>${p.marker}${p.seriesName}: <b>€${Math.round(p.value)}/t</b>${share}`
                     }).join('')
                   } },
        series: [
          ...lines.map(([g]) => {
            const f = freightBy(g)
            return { ...directLabel(lineSeries(route(g), months.map(m => f.get(m)?.value ?? null),
                                               theme.series[slot(g)], theme), theme, g === 'US'),
                     connectNulls: false, xAxisIndex: 0, yAxisIndex: 0 }
          }),
          ...lines.map(([g]) => {
            const q = new Map((d.qty[PARTNERS.findIndex(p => p[0] === g)] || []).map(r => [r.period, Number(r.value)]))
            return { ...lineSeries(route(g), months.map(m => q.get(m) ?? null), theme.series[slot(g)], theme),
                     lineStyle: { width: 1.4, color: theme.series[slot(g)] }, connectNulls: false,
                     xAxisIndex: 1, yAxisIndex: 1 }
          }),
        ],
      },
    }
  }, [d, dir, theme, fromDate])

  const summary = built?.latest?.map(({ g, r }) => `${built.route(g)} €${Math.round(r.value)}/t`).join(' · ')
  return (
    <Card title={`Freight cost per tonne — ${productLabel}`}
      subtitle={`Top: freight + insurance per tonne, trailing 12 months, measured from trade statistics. Bottom: tonnes shipped each month on the same routes.${summary ? ` Latest: ${summary}.` : ''}`}
      right={<Segmented options={[['import', 'Into the EU'], ['export', 'Out of the EU']]} value={dir} onChange={setDir} />}
      method="No free freight index exists for chemical tankers, so freight is measured on the product itself. EU → US: freight, insurance and other charges recorded by US customs on imports from the EU (US Census), per tonne. Other routes: the importer's price on arrival (CIF) minus the exporter's price at departure (FOB; FAS for US exports) — the gap is freight + insurance (+ loading). US → EU: Comext vs US Census; China, India, Saudi Arabia: Comext vs UN Comtrade monthly. Trailing 12 months of summed values and tonnes; needs 9 of 12 months traded on both sides and 1,000 t arriving. Mirror figures carry reporting noise (shipping time, valuation, misattributed partners, different grades under one code): a 12-month window is left out when the two sides' tonnes differ by more than half, or when the gap is below zero, above half the landed price or above €600/t. The method works best for bulk products (caustic soda, EDC, PVC); for specialty codes that mix many grades (polyurethanes, epoxy resins) trust the measured EU → US line most. Comtrade monthly covers the last 36 months only, and China's monthly data stops in December 2024 — the US routes are the long series."
      sourceRows={[{ source: 'US Census Bureau + Eurostat Comext + UN Comtrade', source_dataset: 'freight_cost v1.0',
                     retrieved_at: d?.freight?.at(-1)?.computed_at, quality_flag: 'estimated' }]}>
      {built ? <EChart option={built.option} height={380} theme={theme} />
        : <EmptyState>{d ? 'Not enough trade on these routes to measure freight for this product.' : 'Loading…'}</EmptyState>}
    </Card>
  )
}
