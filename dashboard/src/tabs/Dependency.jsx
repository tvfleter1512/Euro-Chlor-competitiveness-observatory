import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndicators, fetchProducts, fetchRegions } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, StatTile } from '../components'

const CDIS = [
  { id: 'cdi1_hhi', short: 'CDI 1 — HHI', label: 'Import concentration (HHI)' },
  { id: 'cdi2_reliance', short: 'CDI 2 — Reliance', label: 'Extra-EU share of imports' },
  { id: 'cdi3_substitution', short: 'CDI 3 — Substitution', label: 'Extra-EU imports ÷ EU exports' },
]

const CLASS_STYLE = {
  fully_dependent: { label: 'Fully dependent', role: 'critical' },
  high_dependency: { label: 'High dependency', role: 'serious' },
  moderate_dependency: { label: 'Moderate dependency', role: 'warning' },
  low_dependency: { label: 'Low dependency', role: 'good' },
}

export default function Dependency({ product, productLabel }) {
  const theme = useTheme()
  const [rows, setRows] = useState(null)          // all CDI indicator rows, this product
  const [screening, setScreening] = useState(null) // cdi_class rows, all products
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
    setRows(null)
    Promise.all(CDIS.map(c => fetchIndicators({ indicator_id: c.id, product })))
      .then(results => setRows(results.flatMap(r => r.rows)))
      .catch(e => setError(String(e)))
  }, [product])

  const current = useMemo(() => {
    if (!screening || !product) return null
    return screening.find(r => r.product_code === product) || null
  }, [screening, product])

  const thresholds = current?.inputs?.thresholds || {}

  const smallMultiples = useMemo(() => {
    if (!rows) return null
    return CDIS.map(cdi => {
      const annual = rows.filter(r => r.indicator_id === cdi.id && r.period !== 'L12M')
        .sort((a, b) => a.period.localeCompare(b.period))
      const base = baseOption(theme)
      return {
        ...cdi,
        option: {
          ...base,
          grid: { ...base.grid, left: 40, right: 12 },
          xAxis: { ...base.xAxis, data: annual.map(r => r.period) },
          yAxis: { ...base.yAxis,   // axis always shows the threshold line, clean top tick
                   max: ({ max }) => Math.ceil(Math.max(max * 1.1, (thresholds[cdi.id] ?? 0) * 1.15) * 10) / 10 },
          tooltip: { ...base.tooltip, valueFormatter: v => Number(v).toFixed(3) },
          series: [
            lineSeries(cdi.short, annual.map(r => Number(r.value)),
              theme.series.s1, theme),
            {
              type: 'line', data: [], markLine: {
                silent: true, symbol: 'none',
                data: [{ yAxis: thresholds[cdi.id] ?? null }],
                lineStyle: { color: theme.status.serious, type: 'dashed', width: 1 },
                label: { formatter: `threshold ${thresholds[cdi.id] ?? ''}`,
                         position: 'insideEndTop', color: theme.inkMuted, fontSize: 10 },
              },
            },
          ],
        },
      }
    })
  }, [rows, theme, thresholds])

  const supplierOption = useMemo(() => {
    const top = current?.inputs?.top_suppliers?.filter(s => s.share >= 0.001)
    if (!top?.length) return null
    const base = baseOption(theme)
    const items = [...top].reverse()   // largest at the top of a horizontal bar chart
    const shortName = (geo) => {
      const raw = GEO_LABEL[geo] || geoNames[geo] || geo
      const clean = raw.replace(/\s*\(.*$/, '')   // Comext labels carry long parentheticals
      return clean.length > 22 ? clean.slice(0, 21) + '…' : clean
    }
    return {
      ...base,
      grid: { ...base.grid, left: 110, right: 56, bottom: 24 },
      xAxis: { type: 'value',
               splitLine: { lineStyle: { color: theme.grid, width: 1 } },
               axisLabel: { color: theme.inkMuted, fontSize: 11,
                            formatter: v => `${(v * 100).toFixed(0)} %` } },
      yAxis: { type: 'category',
               data: items.map(s => shortName(s.geo)),
               axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
               axisLabel: { color: theme.inkSecondary, fontSize: 11.5 } },
      tooltip: { ...base.tooltip, trigger: 'item',
                 formatter: p => `${p.name}: ${(items[p.dataIndex].share * 100).toFixed(1)} % · ${(items[p.dataIndex].value_eur / 1e6).toFixed(1)} M€` },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: items.map(s => ({ value: s.share, itemStyle: { color: theme.series.s1, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: theme.inkSecondary, fontSize: 11,
                 formatter: p => `${(items[p.dataIndex].share * 100).toFixed(1)} %` },
      }],
    }
  }, [current, theme])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!screening) return <EmptyState>Loading…</EmptyState>
  if (!screening.length) {
    return <EmptyState>No CDI results yet — run the comext_suppliers agent, then benchmarks.</EmptyState>
  }

  const nameOf = (code) => products.find(p => p.product_code === code)?.name || code
  const cls = current ? CLASS_STYLE[current.inputs?.class] : null
  const vsThreshold = (id) => {
    const v = current?.inputs?.cdi_values?.[id]
    const t = thresholds[id]
    if (v == null || t == null) return {}
    const diff = v - t
    return {
      value: v.toFixed(3),
      delta: `${diff >= 0 ? '' : '-'}${Math.abs(diff).toFixed(2)} vs ${t}`,
      deltaGood: diff < 0,   // below threshold = not dependent = good
    }
  }

  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: theme.inkMuted,
               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
               borderBottom: `1px solid ${theme.grid}` }
  const td = { padding: '9px 12px', fontSize: 13, color: theme.ink,
               borderBottom: `1px solid ${theme.grid}` }
  const num = (v, t) => (
    <span style={{ fontVariantNumeric: 'tabular-nums',
                   fontWeight: v > t ? 700 : 400,
                   color: v > t ? theme.bad : theme.ink }}>
      {Number(v).toFixed(3)}
    </span>
  )

  return (
    <>
      {current && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatTile icon="◔" label="CDI 1 — Import concentration" note="HHI, last 12 months"
            {...vsThreshold('cdi1_hhi')} />
          <StatTile icon="⇄" label="CDI 2 — Extra-EU reliance" note="share of import value"
            {...vsThreshold('cdi2_reliance')} />
          <StatTile icon="⇆" label="CDI 3 — Substitution ratio" note="imports ÷ EU exports"
            {...vsThreshold('cdi3_substitution')} />
          <StatTile icon="⚑" label="Classification"
            value={cls?.label} note={`${current.value} of 3 criteria met`} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card title={`Extra-EU supplier concentration — ${productLabel}`}
          subtitle="Share of extra-EU import value, last 12 months, top 10 supplier countries."
          sourceRows={current ? [{
            source: current.inputs?.source || 'Eurostat Comext',
            source_dataset: 'DS-045409 (partner detail)',
            retrieved_at: current.computed_at, quality_flag: 'ok',
          }] : null}>
          {supplierOption ? <EChart option={supplierOption} height={300} theme={theme} />
            : <EmptyState>No supplier detail for this product.</EmptyState>}
        </Card>

        <Card title="Commission screening — all basket products"
          subtitle={`Last 12 months. Red = above threshold. ${current?.inputs?.citation || ''}`}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={th}>Product</th><th style={th}>HHI</th><th style={th}>Reliance</th>
              <th style={th}>Subst.</th><th style={th}>Class</th>
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
                                     whiteSpace: 'nowrap' }}>
                        ● {c.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 20 }}>
        {smallMultiples?.map(sm => (
          <Card key={sm.id} title={sm.short} subtitle={sm.label}>
            <EChart option={sm.option} height={200} theme={theme} />
          </Card>
        ))}
      </div>
    </>
  )
}
