import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { GEO_SLOT, GEO_LABEL, useTheme } from '../theme'
import EChart, { baseOption, lineSeries, directLabel, fmtPeriod } from '../EChart'
import { Card, EmptyState, Headline, Legend, Segmented, SectionHeading, grid2 } from '../components'

const BAND = 'MWH_GE150000'   // largest Eurostat band — chlor-alkali scale
const TAX = 'X_VAT'           // excl. recoverable VAT, incl. non-recoverable levies
const COMPARATORS = ['EU27_2020', 'US', 'US_LA', 'US_TX', 'CN', 'GULF', 'GULF_EI', 'IN']
const DASHED = ['GULF_EI']              // second Gulf line: energy-intensive tariff, eligibility unconfirmed
const SHORT = { GULF: 'Gulf', GULF_EI: 'Gulf (energy-intensive)' }
// names printed at the end of each line (short, so they fit beside the plot)
const END_NAME = { EU27_2020: 'EU27', US: 'US', US_LA: 'Louisiana', US_TX: 'Texas', CN: 'China', GULF: 'Gulf',
                   GULF_EI: 'Gulf (EI tariff)', IN: 'India', DE_LU: 'DE-LU' }
const MWH_PER_MMBTU = 0.293071   // config/conversions.yaml
const NON_EU = COMPARATORS.slice(1)   // fetched converted to EUR by the API
const GAS_BAND = 'GJ100000-999999'    // Eurostat middle industrial band, closest to EIA's all-industry average
const US_GAS = ['US', 'US_LA', 'US_TX']
const EU_DETAIL = ['EU27_2020', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']
const WHOLESALE_ZONES = ['DE_LU', 'FR', 'NL', 'BE', 'ES']   // ENTSO-E bidding zones ingested
const WHOLESALE_DEFAULT_MONTHS = 36                          // initial zoom window

// Align monthly/annual comparator series onto the EU semester grid
// (mirrors the benchmarking agent's alignment, for display only).
function toSemesters(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const sems = /^\d{4}$/.test(r.period) ? [`${r.period}-S1`, `${r.period}-S2`]
      : r.period.includes('-S') ? [r.period]
      : [`${r.period.slice(0, 4)}-S${Number(r.period.slice(5, 7)) <= 6 ? 1 : 2}`]
    for (const sem of sems) {
      if (!buckets.has(sem)) buckets.set(sem, { sample: r, values: [] })
      buckets.get(sem).values.push(Number(r.value))
    }
  }
  return [...buckets.entries()].map(([sem, { sample, values }]) => ({
    ...sample, period: sem,
    value: values.reduce((a, b) => a + b, 0) / values.length,
  }))
}

// Lines per region; the EU (focus) bold, every line named at its end, hover to isolate one
function pivotOption(rows, geos, theme, unit, focus = 'EU27_2020') {
  const periods = [...new Set(rows.map(r => r.period))].sort()
  const present = geos.filter(g => rows.some(r => r.geo_id === g))
  const byGeo = {}
  for (const g of present) {
    const map = new Map(rows.filter(r => r.geo_id === g).map(r => [r.period, Number(r.value)]))
    byGeo[g] = periods.map(p => map.get(p) ?? null)
  }
  const base = baseOption(theme)
  return {
    option: {
      ...base,
      grid: { ...base.grid, right: 104 },
      xAxis: { ...base.xAxis, data: periods, axisLabel: { ...base.xAxis.axisLabel, formatter: fmtPeriod } },
      tooltip: { ...base.tooltip,
                 valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} ${unit}` },
      series: present.map(g => {
        const s = directLabel(lineSeries(END_NAME[g] || GEO_LABEL[g] || g, byGeo[g], theme.series[GEO_SLOT[g]], theme),
                              theme, g === focus)
        return DASHED.includes(g) ? { ...s, lineStyle: { ...s.lineStyle, type: 'dashed' } } : s
      }),
    },
    present,
    periods,
  }
}

function simpleLine({ rows, theme, color, name, valueFmt, height = 240 }) {
  const base = baseOption(theme)
  const data = [...rows].sort((a, b) => a.period.localeCompare(b.period))
  return <EChart height={height} theme={theme} option={{
    ...base,
    xAxis: { ...base.xAxis, data: data.map(r => r.period) },
    tooltip: { ...base.tooltip, valueFormatter: valueFmt },
    series: [lineSeries(name, data.map(r => Number(r.value)), color, theme)],
  }} />
}


// ECU economics: what a tonne of chlorine + its caustic earns (export unit values,
// the margin-proxy revenue) against what it costs. Public: electricity only.
// Member view adds the full cash cost (Argus non-power costs, licensed) and the
// Argus forecast. Annual: the margin proxy is semi-annual, the cash cost annual.
function annualRevenue(marginRows) {
  const byYear = new Map()
  for (const r of marginRows) {
    const i = r.inputs || {}, p = i.params || {}
    if (i.caustic_dry_price_eur_t == null || i.chlorine_value_proxy_eur_t == null) continue
    const y = r.period.slice(0, 4)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y).push({
      revenue: i.caustic_dry_price_eur_t * p.naoh_dry_per_ecu + i.chlorine_value_proxy_eur_t,
      power: i.power_price_eur_mwh * p.mwh_per_ecu,
    })
  }
  const out = new Map()
  for (const [y, halves] of byYear) {
    if (halves.length < 2) continue   // complete years only
    const mean = k => halves.reduce((a, h) => a + h[k], 0) / halves.length
    out.set(y, { revenue: mean('revenue'), power: mean('power') })
  }
  return out
}

function EcuEconomicsCard({ theme, memberMode, fromDate }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([
      fetchIndicators({ indicator_id: 'ecu_margin_proxy' }),
      ...(memberMode ? [
        fetchIndicators({ indicator_id: 'ecu_cash_cost' }),
        fetchIndicators({ indicator_id: 'ecu_cash_cost_wholesale' }),
        fetchSeries({ series_id: 'cost.ecu_cash_cost_argus', geo: 'EU4', band: 'total' }),
      ] : []),
    ]).then(([margin, paid, wholesale, argus]) => setD({
      margin: margin.rows, paid: paid?.rows || [], wholesale: wholesale?.rows || [], argus: argus?.rows || [],
    })).catch(() => setD({ margin: [], paid: [], wholesale: [], argus: [] }))
  }, [memberMode])

  const built = useMemo(() => {
    if (!d?.margin?.length) return null
    const rev = annualRevenue(d.margin)
    const m = rows => new Map(rows.map(r => [r.period, Number(r.value)]))
    const paid = m(d.paid), wholesale = m(d.wholesale), argus = m(d.argus)
    const fromYear = fromDate ? fromDate.slice(0, 4) : '0000'
    const years = [...new Set([...rev.keys(), ...paid.keys(), ...wholesale.keys(), ...argus.keys()])]
      .filter(y => y >= fromYear).sort()
    // margin band: revenue down to the fullest cost line available that year
    const costFor = y => paid.get(y) ?? rev.get(y)?.power ?? null
    const lines = [
      { name: 'ECU revenue (export unit values)', color: theme.series.s4,
        data: years.map(y => rev.get(y)?.revenue ?? null), width: 3 },
      ...(memberMode ? [
        { name: 'Cash cost, as paid (member)', color: theme.series.s6, data: years.map(y => paid.get(y) ?? null) },
        { name: 'Cash cost, Argus basis (member)', color: theme.series.s5, data: years.map(y => wholesale.get(y) ?? null) },
      ] : []),
      { name: 'Electricity cost only', color: theme.series.s8, data: years.map(y => rev.get(y)?.power ?? null) },
    ]
    const base = baseOption(theme)
    const lower = years.map(y => (rev.has(y) && costFor(y) != null) ? Math.min(rev.get(y).revenue, costFor(y)) : null)
    const band = years.map((y, i) => lower[i] == null ? null : Math.abs(rev.get(y).revenue - costFor(y)))
    const option = {
      ...base,
      grid: { ...base.grid, left: 52 },
      xAxis: { ...base.xAxis, data: years, boundaryGap: false },
      tooltip: {
        ...base.tooltip,
        formatter: ps => {
          const y = ps[0]?.axisValue
          const shown = ps.filter(p => !p.seriesName.startsWith('_') && p.value != null)
            .map(p => `${p.marker} ${p.seriesName}: <b>€${Math.round(p.value)}/t</b>`)
          const r = rev.get(y), c = costFor(y)
          if (r && c != null) shown.push(`<span style="color:${theme.inkMuted}">Margin over ${paid.has(y) ? 'cash cost' : 'electricity'}: <b>€${Math.round(r.revenue - c)}/t</b></span>`)
          return [`<b>${y}</b>`, ...shown].join('<br/>')
        },
      },
      series: [
        { name: '_base', type: 'line', stack: 'band', data: lower, symbol: 'none', silent: true,
          lineStyle: { width: 0 }, tooltip: { show: false } },
        { name: '_band', type: 'line', stack: 'band', data: band, symbol: 'none', silent: true,
          lineStyle: { width: 0 }, tooltip: { show: false },
          areaStyle: { color: theme.series.s4, opacity: 0.10 } },
        ...lines.map(l => ({ ...lineSeries(l.name, l.data, l.color, theme), connectNulls: false,
                             showSymbol: true, symbolSize: 6, lineStyle: { width: l.width || 2, color: l.color } })),
        ...(memberMode && argus.size ? [{
          ...lineSeries('Argus forecast cash cost (2023 study)', years.map(y => argus.get(y) ?? null), theme.ink, theme),
          lineStyle: { width: 2, color: theme.ink, type: 'dashed' }, showSymbol: true, symbolSize: 5 }] : []),
      ],
    }
    const legend = [...lines.map(l => ({ label: l.name, color: l.color })),
                    ...(memberMode && argus.size ? [{ label: 'Argus forecast cash cost (2023 study)', color: theme.ink }] : [])]
    return { option, legend }
  }, [d, theme, memberMode, fromDate])

  return (
    <Card title="ECU economics — what a tonne earns vs what it costs"
      subtitle={`€ per tonne ECU, annual. The shaded gap is the margin.${memberMode ? ' Dashed: the Argus 2023 forecast (licensed).' : ' Public view: electricity is the only cost shown — trend use only.'}`}
      method={`ECU = 1 t chlorine + 1.128 t caustic soda. Revenue: extra-EU export unit values (caustic soda dry basis; chlorine valued at the EDC export price per tonne — an upper bound, as it ignores ethylene). Electricity cost: Eurostat price for the largest users × 2.629 MWh.${memberMode
        ? ' Member view: the full plant-gate cash cost adds Argus’ salt, other variable and fixed costs to the electricity bill (Germany, France, Belgium, Spain), with electricity either as paid (Eurostat) or at the wholesale price Argus assumed. The margin is measured against the cash cost where it exists, otherwise against electricity.'
        : ' Salt, other variable and fixed costs are excluded.'}`}
      sourceRows={[{ source: memberMode ? 'Comext unit values + Eurostat nrg_pc_205 + ENTSO-E + Argus Media Consulting 2023 (licensed)' : 'Comext unit values + Eurostat nrg_pc_205',
                     source_dataset: memberMode ? 'ecu_margin_proxy v1.1, ecu_cash_cost / ecu_cash_cost_wholesale v1.0' : 'ecu_margin_proxy v1.1',
                     retrieved_at: d?.margin?.at(-1)?.computed_at, quality_flag: 'estimated' }]}>
      {built ? (<><Legend items={built.legend} /><EChart option={built.option} height={300} theme={theme} /></>)
        : <EmptyState>{d ? 'No ECU series yet.' : 'Loading…'}</EmptyState>}
    </Card>
  )
}


// Labour: wages per employee (public check on the labour part of Argus' fixed
// costs), their growth, and how many people the sector employs.
// US keeps its green (s2) as on every other card; Germany moves off s2 here, the one card showing both
const LABOUR_LEVEL = [['DE', 'Germany', 's4'], ['FR', 'France', 's3'], ['BE', 'Belgium', 's5'],
                      ['ES', 'Spain', 's6'], ['US', 'United States', 's2'], ['US_GULF', 'US Gulf Coast (LA+TX)', 's7']]
const LABOUR_INDEX = [['EU4', 'EU4 chemicals (DE/FR/BE/ES)', 's1'], ['US', 'US inorganic chemicals', 's2'],
                      ['US_LA', 'Louisiana', 's7']]

function LabourCard({ theme, memberMode }) {
  const [view, setView] = useState('level')
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([
      fetchIndicators({ indicator_id: 'wages_per_employee' }),
      fetchIndicators({ indicator_id: 'wages_index' }),
      memberMode ? fetchSeries({ series_id: 'cost.ecu_cash_cost_argus', geo: 'EU4', band: 'fixed' })
                 : Promise.resolve({ rows: [] }),
      fetchSeries({ series_id: 'structure.employment', band: 'C2013' }),
    ]).then(([lvl, idx, fixed, emp]) => setD({ lvl: lvl.rows, idx: idx.rows, fixed: fixed.rows, emp: emp.rows }))
      .catch(() => setD({ lvl: [], idx: [], fixed: [], emp: [] }))
  }, [memberMode])

  const option = useMemo(() => {
    if (!d || view === 'employment') return null
    const base = baseOption(theme)
    const level = view === 'level'
    const rows = level ? d.lvl : d.idx
    const spec = level ? LABOUR_LEVEL : LABOUR_INDEX
    // Argus EU4 fixed costs rebased to 2021 (licensed: member mode only)
    const fx = new Map(d.fixed.map(r => [r.period, Number(r.value)]))
    const argusIdx = !level && fx.get('2021') ? new Map([...fx].map(([y, v]) => [y, v / fx.get('2021') * 100])) : null
    const years = [...new Set([...rows.map(r => r.period), ...(argusIdx ? [...argusIdx.keys()].filter(y => y <= '2026') : [])])]
      .filter(y => y >= (level ? '2018' : '2015')).sort()
    const series = spec.map(([geo, label, slot]) => {
      const m = new Map(rows.filter(r => r.geo_id === geo).map(r => [r.period, Number(r.value)]))
      return { ...lineSeries(label, years.map(y => m.get(y) ?? null), theme.series[slot], theme),
               connectNulls: false, showSymbol: true, symbolSize: 5 }
    })
    if (argusIdx) series.push({ ...lineSeries('Argus EU4 fixed costs (forecast)', years.map(y => argusIdx.get(y) ?? null), theme.ink, theme),
                                lineStyle: { width: 2, color: theme.ink, type: 'dashed' }, showSymbol: true, symbolSize: 5 })
    return {
      ...base,
      xAxis: { ...base.xAxis, data: years },
      yAxis: { ...base.yAxis, scale: !level },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '–' : level ? `€${v.toFixed(1)}k` : v.toFixed(1) },
      series,
    }
  }, [d, view, theme])

  const employment = useMemo(() => {
    if (!d?.emp?.length || view !== 'employment') return null
    const base = baseOption(theme)
    const eu = d.emp.filter(r => r.geo_id === 'EU27_2020').sort((a, b) => a.period.localeCompare(b.period))
    if (!eu.length) return null
    const latest = eu[eu.length - 1]
    const countries = d.emp.filter(r => r.geo_id !== 'EU27_2020' && r.period === latest.period)
      .sort((a, b) => Number(a.value) - Number(b.value))
    return {
      latest,
      trend: {
        ...base,
        grid: { ...base.grid, left: 56 },
        xAxis: { ...base.xAxis, data: eu.map(r => r.period) },
        yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: v => `${(v / 1e3).toFixed(0)}k` } },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toLocaleString('en')} persons` },
        series: [lineSeries('EU27 employment', eu.map(r => Number(r.value)), theme.series.s1, theme)],
      },
      bars: {
        ...base,
        grid: { ...base.grid, left: 84, right: 52, top: 6, bottom: 22 },
        xAxis: { type: 'value', splitLine: { lineStyle: { color: theme.grid, width: 1 } },
                 axisLabel: { color: theme.inkMuted, fontSize: 11, formatter: v => `${(v / 1e3).toFixed(0)}k` } },
        yAxis: { type: 'category', data: countries.map(r => GEO_LABEL[r.geo_id] || r.geo_id),
                 axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
                 axisLabel: { color: theme.inkSecondary, fontSize: 11.5 } },
        tooltip: { ...base.tooltip, trigger: 'item',
                   formatter: p => `${p.name}: ${Number(countries[p.dataIndex].value).toLocaleString('en')} persons` },
        series: [{ type: 'bar', barMaxWidth: 16,
          data: countries.map(r => ({ value: Number(r.value), itemStyle: { color: theme.series.s1, borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', color: theme.inkSecondary, fontSize: 10.5,
                   formatter: p => `${(countries[p.dataIndex].value / 1e3).toFixed(1)}k` } }],
      },
    }
  }, [d, view, theme])

  const spec = view === 'level' ? LABOUR_LEVEL : LABOUR_INDEX
  const legend = spec.map(([, label, slot]) => ({ label, color: theme.series[slot] }))
  if (view === 'index' && d?.fixed?.length) legend.push({ label: 'Argus EU4 fixed costs (forecast)', color: theme.ink })
  const subtitle = {
    level: 'Wages and salaries per employee, k€, annual — inorganic basic chemicals, EU member states vs the US.',
    index: `Growth of wages per employee, 2021 level = 100.${memberMode ? ' Dashed: Argus EU4 fixed costs (licensed).' : ''}`,
    employment: 'Persons employed in inorganic basic chemicals in the EU, annual.',
  }[view]
  const method = {
    level: 'EU: Eurostat structural business statistics, other inorganic basic chemicals (NACE C20.13). US: BLS QCEW, NAICS 325180 (same sector), converted at the annual average ECB rate. Wages only on both sides: QCEW excludes employer health insurance and payroll taxes; in the EU, employer social charges add a further 22–51 % (2024: Germany lowest, France highest). Per person, not per tonne: the sector is broader than chlor-alkali, so a per-tonne figure would mislead. Texas 2024 is unusually high (US Gulf line).',
    index: "2021 = 100 is the Argus study's base year; each series in its own currency. EU4 = Germany, France, Belgium, Spain, all chemicals (NACE C20, the complete series). Labour is only part of Argus' fixed costs (also maintenance, overheads, insurance, tax).",
    employment: 'NACE 20.13, Eurostat SBS (~18-month lag). Broader than chlor-alkali — treat as an upper bound. Pre-2021 points use the archived SBS methodology (2021 not published); the 2017 spike is as published.',
  }[view]
  return (
    <Card title="Labour — wages and employment"
      subtitle={subtitle} method={method}
      right={<Segmented value={view} onChange={setView}
        options={[['level', 'per employee'], ['index', 'growth'], ['employment', 'employment']]} />}
      sourceRows={view === 'employment' ? d?.emp
        : [{ source: 'Eurostat SBS + US BLS QCEW', source_dataset: 'labour_cost v1.0',
             retrieved_at: d?.lvl?.[0]?.computed_at, quality_flag: 'ok' }]}>
      {view === 'employment' ? (employment ? (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 380px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: theme.ink }}>
                {Number(employment.latest.value).toLocaleString('en')}</span>
              <span style={{ fontSize: 12, color: theme.inkSecondary }}>persons, EU27, {employment.latest.period}</span>
            </div>
            <EChart option={employment.trend} height={210} theme={theme} />
          </div>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ fontSize: 12, color: theme.inkSecondary, marginBottom: 4 }}>By member state, {employment.latest.period}</div>
            <EChart option={employment.bars} height={230} theme={theme} />
          </div>
        </div>
      ) : <EmptyState>{d ? 'Awaiting SBS data.' : 'Loading…'}</EmptyState>) : (
        <>
          <Legend items={legend} />
          {option ? <EChart option={option} height={270} theme={theme} /> : <EmptyState>Loading…</EmptyState>}
        </>
      )}
    </Card>
  )
}

// Salt: public check on the salt cost in the Argus study, as wages are for its
// fixed costs. Traded salt for electrolysis (CN 2501 00 31), EU imports from
// other member states and from outside the EU, unit value €/t.
const SALT = '25010031'
const NACL_PER_CL2 = 1.648   // t NaCl per t Cl2, stoichiometric (58.44 / 35.45); plants need a few % more

function SaltCard({ theme, memberMode, fromDate }) {
  const [view, setView] = useState('ecu')
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'trade.value', product: SALT, flow: 'import', freq: 'M' }),
      fetchSeries({ series_id: 'trade.quantity', product: SALT, flow: 'import', freq: 'M' }),
      memberMode ? fetchSeries({ series_id: 'cost.ecu_cash_cost_argus', geo: 'EU4', band: 'salt' }) : Promise.resolve({ rows: [] }),
    ]).then(([v, q, a]) => setD({ v: v.rows, q: q.rows, argus: a.rows })).catch(() => setD({ v: [], q: [], argus: [] }))
  }, [memberMode])

  const built = useMemo(() => {
    if (!d?.v?.length) return null
    const base = baseOption(theme)
    const uv = (partner) => {
      const q = new Map(d.q.filter(r => r.partner_geo_id === partner).map(r => [r.period, Number(r.value)]))
      const out = new Map()
      for (const r of d.v.filter(r => r.partner_geo_id === partner)) {
        const t = q.get(r.period)
        if (t > 1000) out.set(r.period, { eur: Number(r.value), t })   // floor: tiny flows give noisy prices
      }
      return out
    }
    const intra = uv('INTRA_EU'), extra = uv('EXTRA_EU')
    if (view === 'salt') {
      const fromMonth = fromDate ? fromDate.slice(0, 7) : '0000'
      const periods = [...new Set([...intra.keys(), ...extra.keys()])].filter(p => p >= fromMonth).sort()
      const line = (m) => periods.map(p => m.has(p) ? m.get(p).eur / m.get(p).t : null)
      return {
        legend: [{ label: 'From other EU countries', color: theme.series.s1 }, { label: 'From outside the EU', color: theme.series.s8 }],
        option: { ...base, xAxis: { ...base.xAxis, data: periods },
                  tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `€${Number(v).toFixed(0)}/t salt` },
                  series: [lineSeries('From other EU countries', line(intra), theme.series.s1, theme),
                           lineSeries('From outside the EU', line(extra), theme.series.s8, theme)] },
      }
    }
    // per tonne ECU, annual, intra-EU price (volume-weighted over complete years)
    const years = new Map()
    for (const [p, x] of intra) {
      const y = p.slice(0, 4), a = years.get(y) || { eur: 0, t: 0, n: 0 }
      years.set(y, { eur: a.eur + x.eur, t: a.t + x.t, n: a.n + 1 })
    }
    const argus = new Map(d.argus.map(r => [r.period, Number(r.value)]))
    const ys = [...new Set([...[...years].filter(([, a]) => a.n === 12).map(([y]) => y), ...argus.keys()])]
      .filter(y => !fromDate || y >= fromDate.slice(0, 4)).sort()
    return {
      legend: [{ label: `Traded salt × ${NACL_PER_CL2} t per t chlorine`, color: theme.series.s1 },
               ...(argus.size ? [{ label: 'Argus salt cost (member, licensed)', color: theme.ink }] : [])],
      option: { ...base, xAxis: { ...base.xAxis, data: ys },
                tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `€${Number(v).toFixed(0)}/t ECU` },
                series: [
                  { ...lineSeries('Traded salt', ys.map(y => { const a = years.get(y); return a?.n === 12 ? a.eur / a.t * NACL_PER_CL2 : null }), theme.series.s1, theme), showSymbol: true },
                  ...(argus.size ? [{ ...lineSeries('Argus salt cost', ys.map(y => argus.get(y) ?? null), theme.ink, theme),
                                      lineStyle: { width: 2, color: theme.ink, type: 'dashed' }, showSymbol: true }] : []),
                ] },
    }
  }, [d, view, theme, fromDate])

  return (
    <Card title="Salt — the main raw material"
      subtitle={view === 'salt'
        ? 'Price of salt for electrolysis traded into EU countries, € per tonne of salt, monthly.'
        : `Salt cost per tonne ECU, annual.${memberMode ? ' Dashed: the salt cost in the Argus study (licensed).' : ''}`}
      method={view === 'salt'
        ? 'EU imports of salt for electrolysis (CN 2501 00 31), unit value €/t; months under 1,000 t left out. Most of this trade is within the EU. Plants on captive brine wells buy no salt, so for them this is an upper bound.'
        : `The intra-EU traded price (complete years, volume-weighted) × ${NACL_PER_CL2} t salt per t chlorine (stoichiometric minimum; real use is a few % higher). Plants on captive brine wells buy no salt.`}
      right={<Segmented value={view} onChange={setView} options={[['ecu', '€ per t ECU'], ['salt', '€ per t salt']]} />}
      sourceRows={d?.v?.slice(-1)}>
      {built ? (<><Legend items={built.legend} /><EChart option={built.option} height={250} theme={theme} /></>)
        : <EmptyState>{d ? 'No salt trade data yet.' : 'Loading…'}</EmptyState>}
    </Card>
  )
}


// Member view: the plant-gate cash cost of a tonne ECU stacked by component
// (electricity as paid + Argus salt, other variable and fixed costs, licensed),
// with what the tonne earns as a line on the same € scale.
const BUILD_UP = [['power', 'Electricity (as paid)', 's8'], ['salt', 'Salt', 's7'],
                  ['other', 'Other variable costs', 's5'], ['fixed', 'Fixed costs', 's3']]

function CashCostBuildUpCard({ theme, fromDate }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([fetchIndicators({ indicator_id: 'ecu_cash_cost' }), fetchIndicators({ indicator_id: 'ecu_margin_proxy' })])
      .then(([cost, margin]) => setD({ cost: cost.rows, margin: margin.rows }))
      .catch(() => setD({ cost: [], margin: [] }))
  }, [])

  const built = useMemo(() => {
    if (!d?.cost?.length) return null
    const fromYear = fromDate ? fromDate.slice(0, 4) : '0000'
    const rows = [...d.cost].filter(r => r.period >= fromYear).sort((a, b) => a.period.localeCompare(b.period))
    const years = rows.map(r => r.period)
    const rev = annualRevenue(d.margin)
    const base = baseOption(theme)
    const last = BUILD_UP.length - 1
    return {
      latest: rows.at(-1),
      option: {
        ...base,
        grid: { ...base.grid, left: 52 },
        xAxis: { ...base.xAxis, data: years },
        tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' },
                   valueFormatter: v => v == null ? '—' : `€${Math.round(v)}/t` },
        series: [
          ...BUILD_UP.map(([k, name, slot], i) => ({
            name, type: 'bar', stack: 'cost', barMaxWidth: 34, data: rows.map(r => r.inputs?.[k] ?? null),
            itemStyle: { color: theme.series[slot], borderColor: theme.surface, borderWidth: 1,   // thin: 'other' is a small slice
                         borderRadius: i === last ? [4, 4, 0, 0] : 0 },
          })),
          { ...lineSeries('What a tonne earns (export prices)', years.map(y => rev.get(y)?.revenue ?? null), theme.ink, theme),
            showSymbol: true, symbolSize: 7, connectNulls: false },
        ],
      },
    }
  }, [d, theme, fromDate])

  return (
    <Card title="ECU cash cost — what a tonne costs to make, by component"
      subtitle="€ per tonne ECU, annual, Germany, France, Belgium and Spain. Bars: plant-gate cash cost (member view, licensed). Line: what the tonne earns."
      method="Electricity: Eurostat price for the largest users, excluding recoverable taxes, mean of the four countries × 2.629 MWh per tonne ECU. Salt, other variable costs (utilities incl. steam, net of co-product credits) and fixed costs (manpower, maintenance, overheads, insurance, tax): Argus Media 2023 study for Euro Chlor, Fig 5-4, licensed. No depreciation or financing. Revenue: export unit values as in the card below."
      sourceRows={[{ source: 'Eurostat nrg_pc_205 + Argus Media Consulting 2023 (licensed)', source_dataset: 'ecu_cash_cost v1.0',
                     retrieved_at: d?.cost?.at(-1)?.computed_at, quality_flag: 'estimated' }]}>
      {built ? (<>
        <Legend items={[...BUILD_UP.map(([, name, slot]) => ({ label: name, color: theme.series[slot] })),
                        { label: 'What a tonne earns (export prices)', color: theme.ink }]} />
        <EChart option={built.option} height={300} theme={theme} />
      </>) : <EmptyState>{d ? 'No cash-cost series yet.' : 'Loading…'}</EmptyState>}
    </Card>
  )
}

export default function Costs({ fromDate, memberMode }) {
  const theme = useTheme()
  const [d, setD] = useState(null)
  const [priceView, setPriceView] = useState('world')
  const [gasView, setGasView] = useState('hub')
  const [gapGeo, setGapGeo] = useState('US')
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'power.industrial_delivered', band: BAND, tax: TAX, from: fromDate }),
      Promise.all(NON_EU.map(geo => fetchSeries({ series_id: 'power.industrial_delivered', geo, from: fromDate, eur: true }))),
      fetchIndicators({ indicator_id: 'cost_gap' }),
      fetchSeries({ series_id: 'power.wholesale_day_ahead', from: fromDate }),
      fetchSeries({ series_id: 'gas.hub_price', from: fromDate, eur: true }),
      fetchSeries({ series_id: 'carbon.eua_price', from: fromDate }),
      fetchIndicators({ indicator_id: 'carbon_cost_exposure' }),
      fetchSeries({ series_id: 'gas.industrial_delivered', geo: 'EU27_2020', band: GAS_BAND, tax: TAX, from: fromDate }),
      Promise.all(US_GAS.map(geo => fetchSeries({ series_id: 'gas.industrial_delivered', geo, from: fromDate, eur: true }))),
    ]).then(([eu, others, gap, spot, gas, eua, carbon, gasEu, gasUs]) => setD({
      power: [...eu.rows, ...others.flatMap(o => toSemesters(o.rows))],
      gap: gap.rows.filter(r => !fromDate || r.period_start >= fromDate),
      wholesale: spot.rows, gas: gas.rows, eua: eua.rows,
      carbon: carbon.rows.filter(r => !fromDate || r.period_start >= fromDate),
      gasDelivered: [...gasEu.rows, ...gasUs.flatMap(o => toSemesters(o.rows))],
    })).catch(e => setError(String(e)))
  }, [fromDate])

  const costGap = useMemo(() => {
    if (!d?.gap?.length) return null
    const comparators = COMPARATORS.filter(g => d.gap.some(r => r.comparator_geo_id === g))
    const geo = comparators.includes(gapGeo) ? gapGeo : comparators[0]
    const rows = d.gap.filter(r => r.comparator_geo_id === geo).sort((a, b) => a.period.localeCompare(b.period))
    const base = baseOption(theme)
    const upper = rows.map(r => r.inputs?.components?.gap_uncompensated_eur_ecu ?? null)
    const lower = rows.map(r => r.inputs?.components?.gap_max_compensated_eur_ecu ?? null)
    const blue = theme.series.s1
    // band = invisible base line at `lower` + stacked fill up to `upper`
    return {
      geo, comparators, latest: rows.at(-1),
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: rows.map(r => r.period), boundaryGap: false,
                 axisLabel: { ...base.xAxis.axisLabel, formatter: fmtPeriod } },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `€${Number(v).toFixed(0)} per t ECU` },
        series: [
          { name: '_base', type: 'line', stack: 'band', data: lower,
            lineStyle: { width: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
          { name: '_band', type: 'line', stack: 'band', symbol: 'none', silent: true,
            data: upper.map((u, i) => (u != null && lower[i] != null) ? u - lower[i] : null),
            lineStyle: { width: 0 }, tooltip: { show: false },
            areaStyle: { color: blue, opacity: 0.12 } },
          lineSeries('Sites without carbon compensation', upper, blue, theme),
          { ...lineSeries('Sites with maximum compensation', lower, blue, theme),
            lineStyle: { width: 2, color: blue, type: 'dashed' } },
          { type: 'line', data: [], markLine: {
              silent: true, symbol: 'none', data: [{ yAxis: 0 }],
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: 'no gap', position: 'insideStartTop', color: theme.inkSecondary, fontSize: 11 } } },
        ],
      },
    }
  }, [d, theme, gapGeo])

  // hub prices in €/MWh like every other energy price on the page (API converts USD -> EUR)
  const gasOption = useMemo(() => {
    if (!d?.gas?.length) return null
    const base = baseOption(theme)
    const periods = [...new Set(d.gas.map(r => r.period))].sort()
    const grab = geo => {
      const m = new Map(d.gas.filter(r => r.geo_id === geo).map(r => [r.period, Number(r.value) / MWH_PER_MMBTU]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      ...base,
      grid: { ...base.grid, right: 104 },
      xAxis: { ...base.xAxis, data: periods },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} €/MWh` },
      series: [directLabel(lineSeries('EU (TTF)', grab('EU27_2020'), theme.series.s1, theme), theme, true),
               directLabel(lineSeries('US (Henry Hub)', grab('US'), theme.series.s2, theme), theme)],
    }
  }, [d, theme])

  // member states sharing one Annex III CO2 factor have identical lines: one line per factor region
  const carbonOption = useMemo(() => {
    if (!d?.carbon?.length) return null
    const base = baseOption(theme)
    const order = ['DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']
    const zones = new Map()
    for (const g of order) {
      const r = d.carbon.find(x => x.geo_id === g)
      if (!r) continue
      const key = r.inputs?.zone?.key || g
      if (!zones.has(key)) zones.set(key, [])
      zones.get(key).push(g)
    }
    const periods = [...new Set(d.carbon.map(r => r.period))].sort()
    const groups = [...zones.values()]
    return {
      groups,
      option: {
        ...base,
        grid: { ...base.grid, right: 104 },
        xAxis: { ...base.xAxis, data: periods },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `€${Number(v).toFixed(1)} per t ECU` },
        series: groups.map(geos => {
          const m = new Map(d.carbon.filter(r => r.geo_id === geos[0]).map(r => [r.period, Number(r.value)]))
          return directLabel(lineSeries(geos.join(' · '), periods.map(p => m.get(p) ?? null),
                                        theme.series[GEO_SLOT[geos[0]]], theme), theme)
        }),
      },
    }
  }, [d, theme])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!d) return <EmptyState>Loading…</EmptyState>

  const comparatorRows = d.power.filter(r => COMPARATORS.includes(r.geo_id))
  const missing = COMPARATORS.filter(g => !d.power.some(r => r.geo_id === g))
  const detailRows = d.power.filter(r => EU_DETAIL.includes(r.geo_id))
  const price = priceView === 'world'
    ? pivotOption(comparatorRows, COMPARATORS, theme, '€/MWh')
    : pivotOption(detailRows, EU_DETAIL, theme, '€/MWh')

  const spot = pivotOption(d.wholesale, WHOLESALE_ZONES, theme, '€/MWh', 'DE_LU')
  const gasPaid = pivotOption(d.gasDelivered, ['EU27_2020', ...US_GAS], theme, '€/MWh')
  const spotStart = spot.periods[Math.max(0, spot.periods.length - WHOLESALE_DEFAULT_MONTHS)]
  const spotOption = {
    ...spot.option,
    grid: { ...spot.option.grid, bottom: 62 },
    dataZoom: [
      { type: 'slider', startValue: spotStart, height: 18, bottom: 8, borderColor: theme.border,
        fillerColor: theme.accentSoft, handleStyle: { color: theme.surface, borderColor: theme.axis },
        textStyle: { color: theme.inkMuted, fontSize: 10 }, brushSelect: false },
      { type: 'inside', startValue: spotStart },
    ],
  }

  // headline: the latest half-year vs the US, in plain words
  const us = d.gap.filter(r => r.comparator_geo_id === 'US').sort((a, b) => a.period.localeCompare(b.period)).at(-1)
  const c = us?.inputs?.components
  const gapName = costGap ? (GEO_LABEL[costGap.geo] || costGap.geo) : 'comparator'
  const lc = costGap?.latest?.inputs?.components

  return (
    <>
      {us && c && (
        <Headline>
          In <strong>{fmtPeriod(us.period)}</strong> EU plants paid <strong>€{Math.round(us.inputs.eu_power_eur_mwh)}/MWh</strong> for
          electricity against <strong>€{Math.round(us.inputs.comparator_power_eur_mwh)}/MWh</strong> in the US: <strong>€{Math.round(c.gap_uncompensated_eur_ecu)} more
          per tonne ECU</strong> (1 t chlorine + 1.1 t caustic soda), or €{Math.round(c.gap_max_compensated_eur_ecu)} for sites receiving the maximum
          carbon-cost compensation. The page builds the cost up: energy prices, carbon, salt and labour, then the full cost of a tonne
          and what it earns.
        </Headline>
      )}

      <SectionHeading title="1 · Electricity"
        subtitle="The largest cash cost of a chlor-alkali plant: about 2.6 MWh per tonne of chlorine and its caustic soda." />
      <Card sourceRows={priceView === 'world' ? comparatorRows : detailRows}
        title="Industrial electricity price — what plants pay"
        subtitle={priceView === 'world'
          ? `€/MWh, half-yearly, EU vs competitor regions. Hover a line to isolate it.${missing.length ? ` Awaiting data: ${missing.map(g => GEO_LABEL[g]).join(', ')}.` : ''}`
          : 'EU27 and the chlor-alkali producing member states, €/MWh, half-yearly.'}
        method={priceView === 'world'
          ? 'EU: Eurostat delivered price (energy + network + non-recoverable levies, excluding recoverable taxes), largest consumption band ≥150 GWh/yr. US, Louisiana, Texas: EIA average industrial retail price, converted at the ECB monthly rate. China (Shandong), Gulf (Saudi standard tariff; dashed: the energy-intensive tariff from 2023, eligibility unconfirmed), India (Gujarat, fiscal years mapped to half-years): curated published grid tariffs, estimated — likely above what plants with their own power stations pay.'
          : 'Same delivered-price basis as the EU27 line: Eurostat nrg_pc_205, band ≥150 GWh/yr, excluding recoverable taxes.'}
        right={<Segmented value={priceView} onChange={setPriceView}
          options={[['world', 'EU vs world'], ['eu', 'by member state']]} />}>
        <EChart option={price.option} height={320} theme={theme} />
      </Card>

      <Card sourceRows={d.wholesale}
        title="Wholesale electricity price — the energy part of the bill"
        subtitle="Day-ahead market, monthly average by country, €/MWh. Opens on the last three years: drag the slider for the full history."
        method="ENTSO-E day-ahead auction, monthly average of hourly prices per bidding zone. Wholesale energy only — below the delivered price, which adds network costs and levies. It is the price basis the Argus study assumed.">
        {spot.present.length ? <EChart option={spotOption} height={320} theme={theme} />
          : <EmptyState>No wholesale prices yet — the ENTSO-E agent has not reported.</EmptyState>}
      </Card>

      <SectionHeading title="2 · Gas and carbon"
        subtitle="Gas sets the power price in most hours; carbon is passed through it." />
      <div style={grid2}>
        <Card title={gasView === 'hub' ? 'Natural-gas price — EU vs US' : 'Industrial gas price paid — EU vs US'}
          subtitle={gasView === 'hub' ? 'Hub prices, €/MWh, monthly.' : 'Price paid by industry, €/MWh, half-yearly.'}
          method={gasView === 'hub'
            ? 'EU: TTF-based benchmark; US: Henry Hub (FRED). Converted from USD/MMBtu at the ECB monthly rate and 0.293071 MWh per MMBtu.'
            : 'EU: Eurostat nrg_pc_203, band 100,000–999,999 GJ/yr, excluding VAT (gross calorific value). US: EIA average industrial price (all users), $/thousand cubic feet converted at 1.036 MMBtu/Mcf and the ECB rate.'}
          sourceRows={gasView === 'hub' ? d.gas : d.gasDelivered}
          right={<Segmented value={gasView} onChange={setGasView} options={[['hub', 'hub price'], ['delivered', 'paid by industry']]} />}>
          {gasView === 'hub'
            ? (gasOption ? <EChart option={gasOption} height={240} theme={theme} /> : <EmptyState>No gas data.</EmptyState>)
            : <EChart option={gasPaid.option} height={240} theme={theme} />}
        </Card>
        <Card title="EU carbon allowance (EUA) price" subtitle="€ per tonne CO2, monthly average."
          method="Monthly average of daily secondary-market closes (ICAP); months after ICAP's last update from EEX primary auctions, flagged estimated (auctions clear about 1.5 % below)."
          sourceRows={d.eua}>
          {d.eua?.length
            ? simpleLine({ rows: d.eua, theme, color: theme.series.s5, name: 'EUA',
                           valueFmt: v => `${Number(v).toFixed(1)} €/tCO2` })
            : <EmptyState>No EUA data.</EmptyState>}
        </Card>
      </div>
      <Card title="Indirect carbon cost — the carbon inside the power price"
        subtitle="€ per tonne ECU, after the maximum carbon-cost compensation, by CO2-factor region. Already included in the electricity price above — not an extra cost. Sites without compensation pay five times this."
        method="EUA price × Annex III regional CO2 emission factor × 1.846 MWh/t (the ETS benchmark electricity intensity) × (1 − 80 % aid intensity). Countries sharing one regional factor have identical lines and are drawn once. Constants from Communication 2021/C 528/01; the 80 % aid intensity still needs the amending act cited before external use."
        sourceRows={d.carbon?.slice(-1).map(r => ({
          source: 'ICAP EUA + Communication 2021/C 528/01 Annex III',
          source_dataset: `carbon_cost_exposure ${r.methodology_version}`,
          retrieved_at: r.computed_at, quality_flag: 'ok',
        }))}>
        {carbonOption ? <EChart option={carbonOption.option} height={240} theme={theme} />
          : <EmptyState>Awaiting EUA data.</EmptyState>}
      </Card>

      <SectionHeading title="3 · Salt and labour"
        subtitle="The other cost components, checked against public prices and wages." />
      <SaltCard theme={theme} memberMode={memberMode} fromDate={fromDate} />
      <LabourCard theme={theme} memberMode={memberMode} />

      <SectionHeading title="4 · The full cost of a tonne"
        subtitle="The components added up, how Europe's electricity bill compares, and what a tonne earns." />
      {memberMode && <CashCostBuildUpCard theme={theme} fromDate={fromDate} />}
      <Card sourceRows={d.gap}
        title={lc ? `Electricity cost gap vs ${gapName}: €${Math.round(lc.gap_uncompensated_eur_ecu)} per tonne ECU in ${fmtPeriod(costGap.latest.period)}`
                  : `Electricity cost gap vs ${gapName}`}
        subtitle="Extra electricity cost per tonne ECU for an EU plant. Electricity only — not the full cost gap. Shaded: the range between no and maximum carbon-cost compensation."
        method="(EU delivered price − comparator price) × 2.629 MWh per tonne ECU, applied to every region (a simplification: US diaphragm plants use more power and less steam; Chinese and Gulf plants with their own power stations pay below grid tariffs). The carbon cost passed through the EU power price is already inside the measured gap, so it is not added again. Lower line: minus the maximum indirect-cost compensation (EUA × 0.72 t CO2/MWh × 1.846 MWh/t × 80 %); national schemes have caps, so reality sits inside the band. US from official EIA statistics; China, Gulf and India from curated published tariffs — estimates, less comparable."
        right={costGap?.comparators.length > 1 && <Segmented value={costGap.geo} onChange={setGapGeo}
          options={costGap.comparators.map(g => [g, SHORT[g] || GEO_LABEL[g] || g])} />}>
        {costGap && <Legend items={[
          { label: 'Sites without carbon compensation', color: theme.series.s1 },
          { label: 'Sites with maximum compensation', color: theme.series.s1, dashed: true },
        ]} />}
        {costGap ? <EChart option={costGap.option} height={280} theme={theme} />
          : <EmptyState>Cost gap computes once comparator power + EUA data are present.</EmptyState>}
      </Card>
      <EcuEconomicsCard theme={theme} memberMode={memberMode} fromDate={fromDate} />
    </>
  )
}
