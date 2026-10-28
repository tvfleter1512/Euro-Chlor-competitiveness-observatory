// World map of the EU's extra-EU trade in the selected product: one animated arrow
// per partner (width ∝ √volume), partner countries shaded by volume, the EU in
// brand blue. Year slider with play, or the last 12 months.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { fetchSeries } from '../api'
import { useTheme, FONT } from '../theme'
import EChart from '../EChart'
import { Card, EmptyState, Segmented } from '../components'
import { EU27 } from '../tdlinks'
// Natural Earth 1:110m countries (public domain), poles cropped, coordinates rounded;
// anchors = Natural Earth 1:50m label points, so small partners (SG, MT, BH) get an arrow too
import world from '../data/world-110m.json'
import anchors from '../data/country-anchors.json'

echarts.registerMap('world', world)

const EU_ANCHOR = [9.5, 50.2]            // arrow end/start inside the EU
const TOP_ARROWS = 15                    // partners drawn as arrows; the rest shade only
const TO_MAP = { XS: 'RS' }               // Eurostat partner code -> ISO2 used by the map
const NOT_A_COUNTRY = /^(Q|X[CL]$)/       // Comext confidential / stores / Ceuta-Melilla codes
const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const nameOf = g => { try { return REGION.of(TO_MAP[g] || g) } catch { return g } }

export default function TradeMap({ product, productLabel, basis }) {
  const theme = useTheme()
  const [flow, setFlow] = useState('import')
  const [rows, setRows] = useState(null)
  const [period, setPeriod] = useState('L12M')
  const [playing, setPlaying] = useState(false)
  const timer = useRef(null)
  const volume = basis === 'volume'

  useEffect(() => {
    if (!product) return
    setRows(null)
    fetchSeries({ series_id: volume ? 'trade.quantity' : 'trade.value', geo: 'EU27_2020', product,
                  flow, freq: 'M', limit: 100000 })
      .then(d => setRows(d.rows.filter(r => r.partner_geo_id?.length === 2 && !EU27.has(r.partner_geo_id)
                                            && !NOT_A_COUNTRY.test(r.partner_geo_id))))
      .catch(() => setRows([]))
  }, [product, flow, volume])

  // periods: complete calendar years, then the last 12 months
  const { periods, totals, lastMonth } = useMemo(() => {
    if (!rows?.length) return { periods: [], totals: {} }
    const months = [...new Set(rows.map(r => r.period))].sort()
    const byYear = {}
    for (const m of months) (byYear[m.slice(0, 4)] ||= []).push(m)
    const years = Object.keys(byYear).filter(y => byYear[y].length === 12).sort()
    const windows = { ...Object.fromEntries(years.map(y => [y, new Set(byYear[y])])),
                      L12M: new Set(months.slice(-12)) }
    const totals = {}
    for (const [key, win] of Object.entries(windows)) {
      const t = {}
      for (const r of rows) if (win.has(r.period)) t[r.partner_geo_id] = (t[r.partner_geo_id] || 0) + Number(r.value)
      totals[key] = t
    }
    return { periods: [...years, 'L12M'], totals, lastMonth: months.at(-1) }
  }, [rows])

  // play through the years
  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => {
      setPeriod(p => {
        const i = periods.indexOf(p)
        if (i < 0 || i >= periods.length - 1) { setPlaying(false); return 'L12M' }
        return periods[i + 1]
      })
    }, 1400)
    return () => clearInterval(timer.current)
  }, [playing, periods])

  const built = useMemo(() => {
    const t = totals[period]
    if (!t) return null
    const scale = volume ? 1e3 : 1e6
    const unit = volume ? 'kt' : 'M€'
    const all = Object.entries(t).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const sum = all.reduce((a, [, v]) => a + v, 0)
    const max = all[0]?.[1] || 1
    const prevKey = period === 'L12M' ? null : String(Number(period) - 1)
    const prev = prevKey && totals[prevKey]
    const fmt = v => `${(v / scale).toLocaleString('en', { maximumFractionDigits: v / scale < 10 ? 1 : 0 })} ${unit}`
    const tip = (g, v) => {
      const p = prev?.[g]
      const change = p ? ` · ${v >= p ? '+' : '−'}${Math.abs((v / p - 1) * 100).toFixed(0)} % vs ${prevKey}` : ''
      return `<b>${nameOf(g)}</b><br/>${fmt(v)} · ${(v / sum * 100).toFixed(1)} % of extra-EU ${flow}s${change}`
    }
    const arrows = all.slice(0, TOP_ARROWS).filter(([g]) => anchors[TO_MAP[g] || g])
    const toEU = flow === 'import'
    const blue = theme.series.s1
    const option = {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'item', backgroundColor: theme.surface, borderColor: theme.border,
                 textStyle: { color: theme.ink, fontSize: 12 } },
      visualMap: { type: 'continuous', min: 0, max: max / scale, seriesIndex: 0, show: true, calculable: false,
                   left: 8, bottom: 8, itemWidth: 10, itemHeight: 90, text: [fmt(max), '0'],
                   textStyle: { color: theme.inkMuted, fontSize: 10 },
                   inRange: { color: [theme.mode === 'dark' ? '#3a2f12' : '#fff6cc', theme.mode === 'dark' ? '#e0b400' : '#d9a400'] } },
      geo: {
        map: 'world', roam: true, silent: false,
        boundingCoords: [[-128, 73], [152, -46]],   // crop the poles: more room for the flows
        layoutCenter: ['50%', '48%'], layoutSize: '112%',
        itemStyle: { areaColor: theme.mode === 'dark' ? '#2a2828' : '#ecebe7', borderColor: theme.surface, borderWidth: 0.6 },
        emphasis: { itemStyle: { areaColor: theme.axis }, label: { show: false } },
        regions: [...EU27].map(g => ({ name: g, itemStyle: { areaColor: blue, opacity: 0.85 } })),
      },
      series: [
        { type: 'map', geoIndex: 0, data: all.map(([g, v]) => ({ name: TO_MAP[g] || g, value: v / scale, raw: v, iso: g })),
          tooltip: { formatter: p => p.data ? tip(p.data.iso, p.data.raw) : (EU27.has(p.name) ? '<b>EU27</b>' : nameOf(p.name)) } },
        { type: 'lines', coordinateSystem: 'geo', zlevel: 2,
          effect: { show: true, period: 5, trailLength: 0, symbol: 'arrow', symbolSize: 7, color: theme.ink },
          lineStyle: { color: toEU ? theme.series.s8 : blue, opacity: 0.75, curveness: 0.25 },
          tooltip: { formatter: p => tip(p.data.iso, p.data.raw) },
          data: arrows.map(([g, v]) => {
            const a = anchors[TO_MAP[g] || g]
            return { iso: g, raw: v, coords: toEU ? [a, EU_ANCHOR] : [EU_ANCHOR, a],
                     lineStyle: { width: 1 + 9 * Math.sqrt(v / max) } }
          }) },
        { type: 'scatter', coordinateSystem: 'geo', zlevel: 3, symbolSize: 7, silent: true,
          itemStyle: { color: theme.ink }, label: { show: true, position: 'right', formatter: p => p.data.label,
            color: theme.ink, fontSize: 10.5, textBorderColor: theme.surface, textBorderWidth: 2 },
          // label distant partners only: European neighbours crowd around the EU end of the arrows
          data: arrows.filter(([g]) => {
            const [x, y] = anchors[TO_MAP[g] || g]
            return Math.hypot(x - EU_ANCHOR[0], y - EU_ANCHOR[1]) > 18
          }).slice(0, 8).map(([g, v]) => ({ value: anchors[TO_MAP[g] || g], label: `${nameOf(g)} ${fmt(v)}` })) },
      ],
    }
    const ranking = all.slice(0, 12).map(([g, v]) => ({
      g, v, share: v / sum, change: prev?.[g] ? v / prev[g] - 1 : null }))
    return { option, sum, fmt, n: all.length, ranking, prevKey }
  }, [totals, period, theme, flow, volume])

  const label = p => p === 'L12M' ? `12 m to ${lastMonth}` : p
  const cell = { padding: '4px 6px', fontSize: 12.5, color: theme.ink, borderBottom: `1px solid ${theme.grid}`,
                 fontVariantNumeric: 'tabular-nums' }
  const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer', fontFamily: FONT,
                border: `1px solid ${theme.border}`, background: 'transparent', color: theme.ink }
  return (
    <Card title={`Trade map — ${productLabel}`}
      subtitle={`Extra-EU ${flow === 'import' ? 'imports by origin' : 'exports by destination'}, ${volume ? 'tonnes' : '€ value'}. Press play to run through the years.`}
      method={`Eurostat Comext, extra-EU trade by partner. Arrows for the ${TOP_ARROWS} largest partners, width by volume; countries shaded by volume. Drag to pan, scroll to zoom. The ranked list shows the change vs the previous full year.`}
      right={<Segmented value={flow} onChange={setFlow} options={[['import', 'Imports'], ['export', 'Exports']]} />}
      sourceRows={rows?.slice(-1)}>
      {!rows ? <EmptyState>Loading…</EmptyState> : !built ? <EmptyState>No partner data for this product.</EmptyState> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <button style={btn} onClick={() => {
              if (!playing && period === 'L12M') setPeriod(periods[0])
              setPlaying(!playing)
            }}>{playing ? '❚❚ pause' : '▶ play'}</button>
            <input type="range" min={0} max={periods.length - 1} value={Math.max(0, periods.indexOf(period))}
              onChange={e => { setPlaying(false); setPeriod(periods[Number(e.target.value)]) }}
              style={{ flex: '1 1 260px', accentColor: theme.accent }} aria-label="Period" />
            <span style={{ fontSize: 15, fontWeight: 750, color: theme.ink, minWidth: 90 }}>{label(period)}</span>
            <span style={{ fontSize: 12.5, color: theme.inkSecondary }}>
              total {built.fmt(built.sum)} · {built.n} partners
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '3 1 560px', minWidth: 0 }}>
              <EChart option={built.option} height={410} theme={theme} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: theme.ink, marginBottom: 6 }}>
                Largest {flow === 'import' ? 'origins' : 'destinations'}, {label(period)}
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {built.ranking.map(r => (
                    <tr key={r.g}>
                      <td style={cell}>{nameOf(r.g)}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{built.fmt(r.v)}</td>
                      <td style={{ ...cell, textAlign: 'right', color: theme.inkSecondary }}>{(r.share * 100).toFixed(0)} %</td>
                      <td style={{ ...cell, textAlign: 'right', color: r.change == null ? theme.inkMuted : r.change >= 0 ? theme.ink : theme.inkSecondary }}>
                        {r.change == null ? '' : `${r.change >= 0 ? '+' : '−'}${Math.abs(r.change * 100).toFixed(0)} %`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {built.prevKey && <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 6 }}>Change vs {built.prevKey}.</div>}
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
