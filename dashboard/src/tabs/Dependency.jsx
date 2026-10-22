import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndicators, fetchProducts, fetchRegions } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, SectionHeading } from '../components'

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

export default function Dependency({ product, productLabel, setProduct }) {
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
  const thresholds = current?.inputs?.thresholds || {}

  const shortName = (geo) => {
    const raw = GEO_LABEL[geo] || geoNames[geo] || geo
    const clean = raw.replace(/\s*\(.*$/, '')
    return clean.length > 22 ? clean.slice(0, 21) + '…' : clean
  }

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
      yAxis: { type: 'category',
               data: data.map(s => shortName(s.geo) + (s.eea_efta_uk ? ' · EEA' : '')),
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
    return charts
  }, [rows, theme, thresholds])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!screening) return <EmptyState>Loading…</EmptyState>
  if (!screening.length) {
    return <EmptyState>No CDI results yet — run the comext_suppliers agent, then benchmarks.</EmptyState>
  }

  const nameOf = (code) => products.find(p => p.product_code === code)?.name || code
  const cls = current ? CLASS_STYLE[current.inputs?.class] : null
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

  const verdict = cdi => {
    const v = current?.inputs?.cdi_values?.[cdi.id], t = thresholds[cdi.id]
    return v == null || t == null ? cdi.label
      : `${cdi.label}. Last 12 months: ${v.toFixed(3)} vs threshold ${t} — ${cdi.verdict(v >= t)}.`
  }
  const eeaNote = current?.inputs?.top_suppliers?.[0]?.eea_efta_uk &&
    current?.inputs?.cdi_values?.cdi1_hhi > (thresholds.cdi1_hhi ?? 1)
    ? ' Concentration is driven by an EEA/EFTA/UK supplier.' : ''

  return (
    <>
      <SectionHeading title="Import dependency"
        subtitle="European Commission dependency screening (three criteria, last 12 months) for every basket product, then the detail for the selected product." />
      <Card title="Commission screening — all basket products"
        subtitle={`Last 12 months. Red = above threshold. HHI on value (€) and tonnage (t) bases; EEA share = extra-EU imports from EEA/EFTA/UK partners (annotation, not risk math). Click a product to open it. ${current?.inputs?.citation || ''}`}
        sourceRows={src}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={th}>Product</th><th style={th}>HHI €</th><th style={th}>HHI t</th>
            <th style={th}>Reliance</th><th style={th}>Substitution</th>
            <th style={th}>EEA share</th><th style={th}>Classification</th>
          </tr></thead>
          <tbody>
            {[...screening].sort((a, b) => b.value - a.value).map(r => {
              const v = r.inputs?.cdi_values || {}
              const vq = r.inputs?.cdi_values_qty || {}
              const t = r.inputs?.thresholds || {}
              const c = CLASS_STYLE[r.inputs?.class] || {}
              const trusted = r.inputs?.trusted_share
              const mine = r.product_code === product
              return (
                <tr key={r.product_code} onClick={() => setProduct?.(r.product_code)}
                    style={{ cursor: 'pointer', background: mine ? theme.accentSoft : 'transparent' }}>
                  <td style={{ ...td, fontSize: 12, fontWeight: mine ? 700 : 400 }}>{nameOf(r.product_code)}</td>
                  <td style={td}>{num(v.cdi1_hhi, t.cdi1_hhi)}</td>
                  <td style={td}>{vq.cdi1_hhi != null ? num(vq.cdi1_hhi, t.cdi1_hhi) : '—'}</td>
                  <td style={td}>{num(v.cdi2_reliance, t.cdi2_reliance)}</td>
                  <td style={td}>{num(v.cdi3_substitution, t.cdi3_substitution)}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: theme.inkSecondary }}>
                    {trusted != null ? `${(trusted * 100).toFixed(0)} %` : '—'}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11.5, fontWeight: 650, color: theme.status[c.role],
                                   whiteSpace: 'nowrap' }}>● {c.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <div style={{ fontSize: 13, color: theme.inkSecondary, margin: '4px 0 12px' }}>
        <strong style={{ color: theme.ink }}>{productLabel}</strong>
        {cls && <> — <span style={{ color: theme.status[cls.role], fontWeight: 650 }}>{cls.label}</span>
          {' '}({cls.risk.toLowerCase()}, {current.value} of 3 criteria met).{eeaNote}</>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 20 }}>
        {smallMultiples?.map((sm, i) => (
          <Card key={sm.id} title={sm.short} subtitle={verdict(CDIS[i])} sourceRows={i === 0 ? src : null}>
            <EChart option={sm.option} height={190} theme={theme} />
          </Card>
        ))}
      </div>

      <Card title={`Export markets — ${productLabel}`} subtitle="Share of extra-EU export value, last 12 months. (Import origins are in the trade-flow chart above.)"
        sourceRows={src}>
        {current?.inputs?.top_destinations?.filter(s => s.share >= 0.001).length
          ? <EChart option={marketsBar(current.inputs.top_destinations.filter(s => s.share >= 0.001), 'extra-EU exports')} height={280} theme={theme} />
          : <EmptyState>No destination detail yet — re-run comext_suppliers.</EmptyState>}
      </Card>
    </>
  )
}
