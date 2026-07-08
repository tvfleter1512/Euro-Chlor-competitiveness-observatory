import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndicators, fetchProducts, fetchRegions } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, StatTile } from '../components'

const CDIS = [
  { id: 'cdi1_hhi', short: 'CDI 1 — HHI', label: 'Import concentration (HHI)',
    verdict: (above) => above ? 'concentrated extra-EU supply base' : 'diversified extra-EU supply base' },
  { id: 'cdi2_reliance', short: 'CDI 2 — Reliance', label: 'Extra-EU share of imports',
    verdict: (above) => above ? 'strong reliance on extra-EU imports' : 'limited reliance on extra-EU imports' },
  { id: 'cdi3_substitution', short: 'CDI 3 — Substitution', label: 'Extra-EU imports ÷ EU exports',
    verdict: (above) => above ? 'limited substitution capacity within the EU' : 'substitution capacity exists within the EU' },
]

const CLASS_STYLE = {
  fully_dependent: { label: 'Fully dependent', risk: 'High disruption risk', role: 'critical' },
  high_dependency: { label: 'High dependency', risk: 'High disruption risk', role: 'serious' },
  moderate_dependency: { label: 'Moderate dependency', risk: 'Moderate disruption risk', role: 'warning' },
  low_dependency: { label: 'Low dependency', risk: 'Low disruption risk', role: 'good' },
}

// stable slot colors for the stacked market chart, assigned in first-appearance order
const MARKET_SLOTS = ['s1', 's2', 's3', 's5', 's8']

export default function Dependency({ product, productLabel }) {
  const theme = useTheme()
  const [rows, setRows] = useState(null)           // CDI 1/2/3 series, this product
  const [classRows, setClassRows] = useState(null) // cdi_class rows, this product (all windows)
  const [screening, setScreening] = useState(null) // cdi_class L12M, all products
  const [products, setProducts] = useState([])
  const [geoNames, setGeoNames] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([fetchIndicators({ indicator_id: 'cdi_class' }), fetchProducts(), fetchRegions()])
      .then(([cls, p, g]) => {
        setScreening(cls.rows.filter(r => r.period === 'L12M'))
        setProducts(p.products.filter(x => x.nomenclature === 'CN8'))
        setGeoNames(Object.fromEntries(g.geos.map(x => [x.geo_id, x.name])))
      }).catch(e => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!product) return
    setRows(null); setClassRows(null)
    Promise.all([
      ...CDIS.map(c => fetchIndicators({ indicator_id: c.id, product })),
      fetchIndicators({ indicator_id: 'cdi_class', product }),
    ]).then(results => {
      setClassRows(results.pop().rows)
      setRows(results.flatMap(r => r.rows))
    }).catch(e => setError(String(e)))
  }, [product])

  const current = useMemo(
    () => classRows?.find(r => r.period === 'L12M') || null, [classRows])
  const annualClass = useMemo(
    () => (classRows || []).filter(r => r.period !== 'L12M')
      .sort((a, b) => a.period.localeCompare(b.period)), [classRows])
  const thresholds = current?.inputs?.thresholds || {}

  const shortName = (geo) => {
    const raw = GEO_LABEL[geo] || geoNames[geo] || geo
    const clean = raw.replace(/\s*\(.*$/, '')
    return clean.length > 22 ? clean.slice(0, 21) + '…' : clean
  }

  // "Imports markets over the years" — stacked annual value by top supplier + Other
  const marketOption = useMemo(() => {
    if (!annualClass.length) return null
    const totals = {}
    for (const r of annualClass) {
      for (const s of r.inputs?.top_suppliers || []) {
        totals[s.geo] = (totals[s.geo] || 0) + s.value_eur
      }
    }
    const topGeos = Object.entries(totals).sort((a, b) => b[1] - a[1])
      .slice(0, 5).map(([g]) => g)
    const years = annualClass.map(r => r.period)
    const colorOf = (g, i) => theme.series[MARKET_SLOTS[i % MARKET_SLOTS.length]]
    const base = baseOption(theme)
    const mk = (name, data, color) => ({
      name, type: 'line', stack: 'imports', data, symbol: 'none',
      lineStyle: { width: 0 }, areaStyle: { color, opacity: 0.85 },
      itemStyle: { color }, emphasis: { focus: 'series' },
    })
    const series = topGeos.map((g, i) => mk(shortName(g), annualClass.map(r => {
      const s = (r.inputs?.top_suppliers || []).find(x => x.geo === g)
      return s ? Math.round(s.value_eur / 1e6) : 0
    }), colorOf(g, i)))
    series.push(mk('Other', annualClass.map(r => {
      const listed = (r.inputs?.top_suppliers || [])
        .filter(x => topGeos.includes(x.geo))
        .reduce((a, x) => a + x.value_eur, 0)
      return Math.max(0, Math.round(((r.inputs?.supplier_total_eur || 0) - listed) / 1e6))
    }), theme.axis))
    return {
      legendItems: [...topGeos.map((g, i) => ({ label: shortName(g), color: colorOf(g, i) })),
                    { label: 'Other', color: theme.axis }],
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: years, boundaryGap: false },
        yAxis: { ...base.yAxis },
        tooltip: { ...base.tooltip, valueFormatter: v => `${v} M€` },
        series,
      },
    }
  }, [annualClass, theme, geoNames])

  const marketsBar = (items, denomLabel) => {
    if (!items?.length) return null
    const data = [...items].reverse()
    const base = baseOption(theme)
    return {
      ...base,
      grid: { ...base.grid, left: 110, right: 56, bottom: 24 },
      xAxis: { type: 'value',
               splitLine: { lineStyle: { color: theme.grid, width: 1 } },
               axisLabel: { color: theme.inkMuted, fontSize: 11,
                            formatter: v => `${(v * 100).toFixed(0)} %` } },
      yAxis: { type: 'category', data: data.map(s => shortName(s.geo)),
               axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
               axisLabel: { color: theme.inkSecondary, fontSize: 11.5 } },
      tooltip: { ...base.tooltip, trigger: 'item',
                 formatter: p => `${p.name}: ${(data[p.dataIndex].share * 100).toFixed(1)} % of ${denomLabel} · ${(data[p.dataIndex].value_eur / 1e6).toFixed(1)} M€` },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: data.map(s => ({ value: s.share, itemStyle: { color: theme.series.s1, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: theme.inkSecondary, fontSize: 11,
                 formatter: p => `${(data[p.dataIndex].share * 100).toFixed(1)} %` },
      }],
    }
  }

  const smallMultiples = useMemo(() => {
    if (!rows) return null
    const charts = CDIS.map(cdi => {
      const annual = rows.filter(r => r.indicator_id === cdi.id && r.period !== 'L12M')
        .sort((a, b) => a.period.localeCompare(b.period))
      const base = baseOption(theme)
      return {
        id: cdi.id, short: cdi.short, label: cdi.label,
        option: {
          ...base,
          grid: { ...base.grid, left: 40, right: 12 },
          xAxis: { ...base.xAxis, data: annual.map(r => r.period) },
          yAxis: { ...base.yAxis,
                   max: ({ max }) => Math.ceil(Math.max(max * 1.1, (thresholds[cdi.id] ?? 0) * 1.15) * 10) / 10 },
          tooltip: { ...base.tooltip, valueFormatter: v => Number(v).toFixed(3) },
          series: [
            lineSeries(cdi.short, annual.map(r => Number(r.value)), theme.series.s1, theme),
            { type: 'line', data: [], markLine: {
                silent: true, symbol: 'none',
                data: [{ yAxis: thresholds[cdi.id] ?? null }],
                lineStyle: { color: theme.status.serious, type: 'dashed', width: 1 },
                label: { formatter: `threshold ${thresholds[cdi.id] ?? ''}`,
                         position: 'insideEndTop', color: theme.inkMuted, fontSize: 10 } } },
          ],
        },
      }
    })
    // 4th panel: extra-EU imports indexed to the first year = 100
    if (annualClass.length > 1) {
      const first = annualClass[0].inputs?.extra_eu_imports_eur || 0
      if (first > 0) {
        const base = baseOption(theme)
        charts.push({
          id: 'index', short: 'Extra-EU imports', label: `Index ${annualClass[0].period} = 100`,
          option: {
            ...base,
            grid: { ...base.grid, left: 40, right: 12 },
            xAxis: { ...base.xAxis, data: annualClass.map(r => r.period) },
            tooltip: { ...base.tooltip, valueFormatter: v => `${Number(v).toFixed(0)}` },
            series: [
              lineSeries('Index', annualClass.map(r =>
                Math.round((r.inputs?.extra_eu_imports_eur || 0) / first * 100)),
                theme.series.s8, theme),
              { type: 'line', data: [], markLine: {
                  silent: true, symbol: 'none', data: [{ yAxis: 100 }],
                  lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
                  label: { show: false } } },
            ],
          },
        })
      }
    }
    return charts
  }, [rows, annualClass, theme, thresholds])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!screening) return <EmptyState>Loading…</EmptyState>
  if (!screening.length) {
    return <EmptyState>No CDI results yet — run the comext_suppliers agent, then benchmarks.</EmptyState>
  }

  const nameOf = (code) => products.find(p => p.product_code === code)?.name || code
  const cls = current ? CLASS_STYLE[current.inputs?.class] : null
  const tile = (cdi) => {
    const v = current?.inputs?.cdi_values?.[cdi.id]
    const t = thresholds[cdi.id]
    if (v == null || t == null) return { value: '—' }
    const diff = v - t
    return {
      value: v.toFixed(3),
      delta: `${diff >= 0 ? '' : '-'}${Math.abs(diff).toFixed(2)} vs ${t}`,
      deltaGood: diff < 0,
      note: cdi.verdict(diff >= 0),
    }
  }

  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: theme.inkMuted,
               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
               borderBottom: `1px solid ${theme.grid}` }
  const td = { padding: '9px 12px', fontSize: 13, color: theme.ink,
               borderBottom: `1px solid ${theme.grid}` }
  const num = (v, t) => (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: v > t ? 700 : 400,
                   color: v > t ? theme.bad : theme.ink }}>
      {Number(v).toFixed(3)}
    </span>
  )

  const src = current ? [{
    source: 'Eurostat Comext', source_dataset: 'DS-045409 (partner detail)',
    retrieved_at: current.computed_at, quality_flag: 'ok',
  }] : null

  return (
    <>
      {current && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {CDIS.map(c => <StatTile key={c.id} icon="◔" label={c.short} {...tile(c)} />)}
          <StatTile icon="⚑" label="Classification" value={cls?.label}
            note={`${cls?.risk} · ${current.value} of 3 criteria met`} />
        </div>
      )}

      <Card title={`Import markets over the years — ${productLabel}`}
        subtitle="Extra-EU import value by supplier country, annual, M€. Top 5 suppliers + other."
        sourceRows={src}
        right={marketOption && <Legend items={marketOption.legendItems} />}>
        {marketOption ? <EChart option={marketOption.option} height={280} theme={theme} />
          : <EmptyState>No annual supplier history yet.</EmptyState>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card title="Import markets" subtitle="Share of extra-EU import value, last 12 months."
          sourceRows={src}>
          {current?.inputs?.top_suppliers?.filter(s => s.share >= 0.001).length
            ? <EChart option={marketsBar(current.inputs.top_suppliers.filter(s => s.share >= 0.001), 'extra-EU imports')} height={280} theme={theme} />
            : <EmptyState>No supplier detail.</EmptyState>}
        </Card>
        <Card title="Export markets" subtitle="Share of extra-EU export value, last 12 months."
          sourceRows={src}>
          {current?.inputs?.top_destinations?.filter(s => s.share >= 0.001).length
            ? <EChart option={marketsBar(current.inputs.top_destinations.filter(s => s.share >= 0.001), 'extra-EU exports')} height={280} theme={theme} />
            : <EmptyState>No destination detail yet — re-run comext_suppliers.</EmptyState>}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 20 }}>
        {smallMultiples?.map(sm => (
          <Card key={sm.id} title={sm.short} subtitle={sm.label}>
            <EChart option={sm.option} height={190} theme={theme} />
          </Card>
        ))}
      </div>

      <Card title="Commission screening — all basket products"
        subtitle={`Last 12 months. Red = above threshold. ${current?.inputs?.citation || ''}`}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={th}>Product</th><th style={th}>HHI</th><th style={th}>Reliance</th>
            <th style={th}>Substitution</th><th style={th}>Classification</th>
          </tr></thead>
          <tbody>
            {[...screening].sort((a, b) => b.value - a.value).map(r => {
              const v = r.inputs?.cdi_values || {}
              const t = r.inputs?.thresholds || {}
              const c = CLASS_STYLE[r.inputs?.class] || {}
              return (
                <tr key={r.product_code}>
                  <td style={{ ...td, fontSize: 12 }}>{nameOf(r.product_code)}</td>
                  <td style={td}>{num(v.cdi1_hhi, t.cdi1_hhi)}</td>
                  <td style={td}>{num(v.cdi2_reliance, t.cdi2_reliance)}</td>
                  <td style={td}>{num(v.cdi3_substitution, t.cdi3_substitution)}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11.5, fontWeight: 650, color: theme.status[c.role],
                                   whiteSpace: 'nowrap' }}>● {c.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </>
  )
}
