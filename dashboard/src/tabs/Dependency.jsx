import React, { useEffect, useMemo, useState } from 'react'
import { fetchIndicators, fetchProducts } from '../api'
import { useTheme } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState } from '../components'

const CDIS = [
  { id: 'cdi1_hhi', short: 'CDI 1 — Supplier concentration', label: 'Import concentration (HHI)',
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

const src = row => row ? [{
  source: 'Eurostat Comext', source_dataset: 'DS-045409 (partner detail)',
  retrieved_at: row.computed_at, quality_flag: 'ok',
}] : null

// European Commission dependency screening, last 12 months, every basket product
export function DependencyScreening({ product, setProduct }) {
  const theme = useTheme()
  const [screening, setScreening] = useState(null)
  const [products, setProducts] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([fetchIndicators({ indicator_id: 'cdi_class' }), fetchProducts()])
      .then(([cls, p]) => {
        setScreening(cls.rows.filter(r => r.period === 'L12M'))
        setProducts(p.products.filter(x => x.nomenclature === 'CN8'))
      }).catch(e => setError(String(e)))
  }, [])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!screening) return <EmptyState>Loading…</EmptyState>
  if (!screening.length) {
    return <EmptyState>No CDI results yet — run the comext_suppliers agent, then benchmarks.</EmptyState>
  }

  const nameOf = (code) => products.find(p => p.product_code === code)?.name || code
  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: theme.inkMuted,
               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
               borderBottom: `1px solid ${theme.grid}` }
  const td = { padding: '9px 12px', fontSize: 13, color: theme.ink,
               borderBottom: `1px solid ${theme.grid}` }
  const breach = theme.mode === 'dark' ? 'rgba(230,103,103,0.16)' : 'rgba(208,59,59,0.08)'
  // over-threshold cells: glyph + tinted fill + bold red, so colour is never the only cue
  const cell = (v, t) => {
    const over = v != null && t != null && v > t
    return (
      <td style={{ ...td, background: over ? breach : 'transparent' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: over ? 700 : 400,
                       color: over ? theme.bad : theme.ink }}>
          {v == null ? '—' : `${over ? '✗ ' : ''}${Number(v).toFixed(3)}`}
        </span>
      </td>
    )
  }
  const sample = screening[0]

  return (
    <Card title="Import dependency — Commission screening, all products"
      subtitle="Three tests per product over the last 12 months; ✗ = above the Commission threshold. Click a product to open it below."
      method={`CDI 1 (HHI): how concentrated imports are on few supplier countries, on value (€) and tonnage (t). CDI 2 (reliance): share of EU imports coming from outside the EU. CDI 3 (substitution): extra-EU imports ÷ EU exports — could EU output replace the imports? EEA share = extra-EU imports from Norway, Switzerland, the UK and other EEA/EFTA partners (annotation, not part of the risk math). ${sample?.inputs?.citation || ''}`}
      sourceRows={src(sample)}>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>
          <th style={th}>Product</th><th style={th}>Supplier concentration €</th><th style={th}>… tonnes</th>
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
                {cell(v.cdi1_hhi, t.cdi1_hhi)}
                {cell(vq.cdi1_hhi, t.cdi1_hhi)}
                {cell(v.cdi2_reliance, t.cdi2_reliance)}
                {cell(v.cdi3_substitution, t.cdi3_substitution)}
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
  )
}

// The three Commission tests over time for the selected product, threshold zone shaded
export function DependencyDetail({ product, productLabel }) {
  const theme = useTheme()
  const [rows, setRows] = useState(null)           // CDI 1/2/3 series, this product
  const [classRows, setClassRows] = useState(null) // cdi_class rows, this product (all windows)
  const [error, setError] = useState(null)

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

  const smallMultiples = useMemo(() => {
    if (!rows) return null
    return CDIS.map(cdi => {
      const annual = rows.filter(r => r.indicator_id === cdi.id && r.period !== 'L12M')
        .sort((a, b) => a.period.localeCompare(b.period))
      const base = baseOption(theme)
      const t = thresholds[cdi.id]
      const yMax = Math.ceil(Math.max(Math.max(...annual.map(r => Number(r.value)), 0) * 1.1, (t ?? 0) * 1.15) * 10) / 10
      return {
        id: cdi.id, short: cdi.short, label: cdi.label,
        option: {
          ...base,
          grid: { ...base.grid, left: 40, right: 12 },
          xAxis: { ...base.xAxis, data: annual.map(r => r.period) },
          yAxis: { ...base.yAxis, max: yMax },
          tooltip: { ...base.tooltip, valueFormatter: v => Number(v).toFixed(3) },
          series: [
            lineSeries(cdi.short, annual.map(r => Number(r.value)), theme.series.s1, theme),
            { type: 'line', data: [],
              markArea: t == null ? undefined : { silent: true, itemStyle: { color: theme.status.serious, opacity: 0.08 },
                                                  data: [[{ yAxis: t }, { yAxis: yMax }]] },
              markLine: {
                silent: true, symbol: 'none',
                data: [{ yAxis: t ?? null }],
                lineStyle: { color: theme.status.serious, type: 'dashed', width: 1 },
                label: { formatter: `threshold ${t ?? ''}`,
                         position: 'insideEndTop', color: theme.inkMuted, fontSize: 10 } } },
          ],
        },
      }
    })
  }, [rows, theme, thresholds])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!rows) return <EmptyState>Loading…</EmptyState>

  const cls = current ? CLASS_STYLE[current.inputs?.class] : null
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
      <div style={{ fontSize: 13, color: theme.inkSecondary, margin: '4px 0 12px' }}>
        <strong style={{ color: theme.ink }}>Import dependency, {productLabel}</strong>
        {cls && <> — <span style={{ color: theme.status[cls.role], fontWeight: 650 }}>{cls.label}</span>
          {' '}({cls.risk.toLowerCase()}, {current.value} of 3 criteria met).{eeaNote}</>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 20 }}>
        {smallMultiples?.map((sm, i) => (
          <Card key={sm.id} title={sm.short} subtitle={verdict(CDIS[i])} sourceRows={i === 0 ? src(current) : null}>
            <EChart option={sm.option} height={190} theme={theme} />
          </Card>
        ))}
      </div>
    </>
  )
}
