import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { GEO_SLOT, GEO_LABEL, useTheme } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, Segmented, SectionHeading, grid2 } from '../components'

const BAND = 'MWH_GE150000'   // largest Eurostat band — chlor-alkali scale
const TAX = 'X_VAT'           // excl. recoverable VAT, incl. non-recoverable levies
const COMPARATORS = ['EU27_2020', 'US', 'CN', 'GULF', 'IN']
const EU_DETAIL = ['EU27_2020', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']
const WHOLESALE_ZONES = ['DE_LU', 'FR', 'NL', 'BE', 'ES']   // ENTSO-E bidding zones ingested
const WHOLESALE_DEFAULT_MONTHS = 36                          // initial zoom window

// Align monthly/annual comparator series onto the EU semester grid
// (mirrors the benchmarking agent's alignment, for display only).
function toSemesters(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const sems = /^\d{4}$/.test(r.period)
      ? [`${r.period}-S1`, `${r.period}-S2`]
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

function pivotOption(rows, geos, theme, unit) {
  const periods = [...new Set(rows.map(r => r.period))].sort()
  const present = geos.filter(g => rows.some(r => r.geo_id === g))
  const byGeo = {}
  for (const g of present) {
    const map = new Map(rows.filter(r => r.geo_id === g).map(r => [r.period, Number(r.value)]))
    byGeo[g] = periods.map(p => map.get(p) ?? null)
  }
  return {
    option: {
      ...baseOption(theme),
      xAxis: { ...baseOption(theme).xAxis, data: periods },
      tooltip: { ...baseOption(theme).tooltip,
                 valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} ${unit}` },
      series: present.map(g =>
        lineSeries(GEO_LABEL[g] || g, byGeo[g], theme.series[GEO_SLOT[g]], theme)),
    },
    present,
    periods,
  }
}

const geoLegend = (geos, theme) => geos.map(g => ({ label: GEO_LABEL[g] || g, color: theme.series[GEO_SLOT[g]] }))

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
      subtitle={`EUR per tonne ECU (1 t chlorine + 1.128 t caustic soda), annual. Revenue: extra-EU export unit values (caustic soda dry basis, chlorine valued at the EDC price per tonne — an upper bound as it ignores ethylene). Electricity cost: Eurostat price for the largest users × 2.629 MWh. The shaded gap is the margin.${memberMode
        ? ' Member view: the full plant-gate cash cost adds Argus’ salt, other variable and fixed costs to the electricity bill (Germany, France, Belgium, Spain), with electricity either as paid (Eurostat) or at the wholesale price Argus assumed; dashed: the Argus 2023 forecast. Argus figures are licensed.'
        : ' Excludes salt, other variable and fixed costs — trend use only.'}`}
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
const LABOUR_LEVEL = [['DE', 'Germany', 's2'], ['FR', 'France', 's3'], ['BE', 'Belgium', 's5'],
                      ['ES', 'Spain', 's6'], ['US', 'United States', 's8'], ['US_GULF', 'US Gulf Coast (LA+TX)', 's7']]
const LABOUR_INDEX = [['EU4', 'EU4 chemicals (DE/FR/BE/ES)', 's1'], ['US', 'US inorganic chemicals', 's8'],
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
    level: 'Wages and salaries per employee, kEUR, annual. EU: Eurostat structural business statistics, other inorganic basic chemicals (NACE C20.13). US: BLS QCEW, NAICS 325180 (same sector), converted at the annual average ECB rate. Wages only on both sides: QCEW excludes employer health insurance and payroll taxes; in the EU, employer social charges add a further 22–51 % (2024: Germany lowest, France highest). Per person, not per tonne. Texas 2024 is unusually high (US Gulf line).',
    index: `Growth of wages per employee, 2021 = 100 (the Argus study's base year), each in its own currency. EU4 = Germany, France, Belgium, Spain, all chemicals (NACE C20, the complete series). Labour is only part of Argus' fixed costs (also maintenance, overheads, insurance, tax).${memberMode ? ' Dashed: Argus EU4 fixed costs, licensed.' : ''}`,
    employment: 'Persons employed in other inorganic basic chemicals (NACE 20.13), annual, Eurostat SBS (~18-month lag). Broader than chlor-alkali — treat as an upper bound. Pre-2021 points use the archived SBS methodology (2021 not published); the 2017 spike is as published.',
  }[view]
  return (
    <Card title="Labour — wages and employment"
      subtitle={subtitle}
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

export default function Costs({ fromDate, memberMode }) {
  const theme = useTheme()
  const [d, setD] = useState(null)
  const [priceView, setPriceView] = useState('world')
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'power.industrial_delivered', band: BAND, tax: TAX, from: fromDate }),
      fetchSeries({ series_id: 'power.industrial_delivered', geo: 'US', from: fromDate }),
      fetchIndicators({ indicator_id: 'cost_gap' }),
      fetchSeries({ series_id: 'power.wholesale_day_ahead', from: fromDate }),
      fetchSeries({ series_id: 'gas.hub_price', from: fromDate }),
      fetchSeries({ series_id: 'carbon.eua_price', from: fromDate }),
      fetchIndicators({ indicator_id: 'carbon_cost_exposure' }),
    ]).then(([eu, us, gap, spot, gas, eua, carbon]) => setD({
      power: [...eu.rows, ...toSemesters(us.rows)],
      gap: gap.rows.filter(r => !fromDate || r.period_start >= fromDate),
      wholesale: spot.rows, gas: gas.rows, eua: eua.rows,
      carbon: carbon.rows.filter(r => !fromDate || r.period_start >= fromDate),
    })).catch(e => setError(String(e)))
  }, [fromDate])

  const costGap = useMemo(() => {
    if (!d?.gap?.length) return null
    const comparators = [...new Set(d.gap.map(r => r.comparator_geo_id))]
    const geo = comparators.includes('US') ? 'US' : comparators[0]
    const rows = d.gap.filter(r => r.comparator_geo_id === geo).sort((a, b) => a.period.localeCompare(b.period))
    const base = baseOption(theme)
    const upper = rows.map(r => r.inputs?.components?.gap_uncompensated_eur_ecu ?? null)
    const lower = rows.map(r => r.inputs?.components?.gap_max_compensated_eur_ecu ?? null)
    // band = invisible base line at `lower` + stacked fill up to `upper`
    return {
      geo,
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: rows.map(r => r.period), boundaryGap: false },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(0)} €/ECU` },
        series: [
          { name: '_base', type: 'line', stack: 'band', data: lower,
            lineStyle: { width: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
          { name: '_band', type: 'line', stack: 'band', symbol: 'none', silent: true,
            data: upper.map((u, i) => (u != null && lower[i] != null) ? u - lower[i] : null),
            lineStyle: { width: 0 }, tooltip: { show: false },
            areaStyle: { color: theme.series.s1, opacity: 0.12 } },
          lineSeries('Uncompensated sites', upper, theme.series.s1, theme),
          lineSeries('Maximum ETS compensation', lower, theme.series.s2, theme),
          { type: 'line', data: [], markLine: {
              silent: true, symbol: 'none', data: [{ yAxis: 0 }],
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 },
              label: { formatter: 'parity', position: 'insideEndTop', color: theme.inkMuted, fontSize: 10 } } },
        ],
      },
    }
  }, [d, theme])

  const gasOption = useMemo(() => {
    if (!d?.gas?.length) return null
    const base = baseOption(theme)
    const periods = [...new Set(d.gas.map(r => r.period))].sort()
    const grab = geo => {
      const m = new Map(d.gas.filter(r => r.geo_id === geo).map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      ...base,
      xAxis: { ...base.xAxis, data: periods },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} $/MMBtu` },
      series: [lineSeries('EU (TTF-based)', grab('EU27_2020'), theme.series.s1, theme),
               lineSeries('US Henry Hub', grab('US'), theme.series.s2, theme)],
    }
  }, [d, theme])

  const carbonOption = useMemo(() => {
    if (!d?.carbon?.length) return null
    const base = baseOption(theme)
    const geos = ['DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL'].filter(g => d.carbon.some(r => r.geo_id === g))
    const periods = [...new Set(d.carbon.map(r => r.period))].sort()
    const grab = g => {
      const m = new Map(d.carbon.filter(r => r.geo_id === g).map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      geos,
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: periods },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} €/t` },
        series: geos.map(g => lineSeries(GEO_LABEL[g] || g, grab(g), theme.series[GEO_SLOT[g]], theme)),
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

  const spot = pivotOption(d.wholesale, WHOLESALE_ZONES, theme, '€/MWh')
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

  return (
    <>
      <SectionHeading title="Electricity"
        subtitle="The largest cash cost of a chlor-alkali plant: about 2.6 MWh per tonne of chlorine and its caustic soda." />
      <Card sourceRows={d.gap}
        title={`Cost gap vs ${costGap ? (GEO_LABEL[costGap.geo] || costGap.geo) : 'comparator'} — € per tonne ECU`}
        subtitle="The headline: measured power-price gap × 2.629 MWh/ECU (CO2 pass-through is inside the price — not double-counted). Band = value of maximum ETS indirect-cost compensation; actual schemes have national caps, so reality sits inside the band. Member states without compensation sit on the top line. China and the Gulf: no comparable delivered-price data yet — an open data point for the expert group."
        right={costGap && <Legend items={[
          { label: 'Uncompensated sites', color: theme.series.s1 },
          { label: 'Max ETS compensation', color: theme.series.s2 },
        ]} />}>
        {costGap ? <EChart option={costGap.option} height={280} theme={theme} />
          : <EmptyState>Cost gap computes once comparator power + EUA data are present.</EmptyState>}
      </Card>

      <Card sourceRows={priceView === 'world' ? comparatorRows : detailRows}
        title="Industrial delivered electricity price"
        subtitle={priceView === 'world'
          ? `EU vs world regions. Delivered price (energy + network + non-recoverable levies), band ≥150 GWh/yr, €/MWh.${missing.length ? ` Awaiting data: ${missing.map(g => GEO_LABEL[g]).join(', ')}.` : ''}`
          : 'EU27 and the chlor-alkali producing member states, same delivered-price basis, €/MWh.'}
        right={<Segmented value={priceView} onChange={setPriceView}
          options={[['world', 'EU vs world'], ['eu', 'by member state']]} />}>
        <Legend items={geoLegend(price.present, theme)} />
        <EChart option={price.option} height={300} theme={theme} />
      </Card>

      <Card sourceRows={d.wholesale}
        title="Wholesale day-ahead electricity price — monthly average"
        subtitle="ENTSO-E day-ahead auction, monthly average of hourly prices per bidding zone, €/MWh. Wholesale energy only — below the delivered price, which adds network costs and levies; it is the price the Argus study assumed. Opens on the last three years: drag the slider for the full history."
        right={<Legend items={geoLegend(spot.present, theme)} />}>
        {spot.present.length ? <EChart option={spotOption} height={320} theme={theme} />
          : <EmptyState>No wholesale prices yet — the ENTSO-E agent has not reported.</EmptyState>}
      </Card>

      <SectionHeading title="Gas and carbon"
        subtitle="The drivers behind the power price, and the carbon cost passed through it." />
      <div style={grid2}>
        <Card title="Natural-gas hub prices — EU vs US"
          subtitle="Monthly, USD/MMBtu. Gas sets the marginal power price in most EU hours."
          sourceRows={d.gas}
          right={<Legend items={[{ label: 'EU (TTF-based)', color: theme.series.s1 },
                                 { label: 'US Henry Hub', color: theme.series.s2 }]} />}>
          {gasOption ? <EChart option={gasOption} height={240} theme={theme} /> : <EmptyState>No gas data.</EmptyState>}
        </Card>
        <Card title="EUA carbon price" subtitle="Monthly average of daily secondary-market closes, EUR/tCO2 (ICAP)."
          sourceRows={d.eua}>
          {d.eua?.length
            ? simpleLine({ rows: d.eua, theme, color: theme.series.s5, name: 'EUA',
                           valueFmt: v => `${Number(v).toFixed(1)} €/tCO2` })
            : <EmptyState>No EUA data.</EmptyState>}
        </Card>
      </div>
      <Card title="Indirect carbon cost per tonne Cl2 — by member state"
        subtitle="EUA × Annex III regional CO2 factor × 1.846 MWh/t × (1 − 80% aid). Net of MAX compensation — member states without compensation face 5× this. Constants cited to Communication 2021/C 528/01, confirmed."
        sourceRows={d.carbon?.slice(-1).map(r => ({
          source: 'ICAP EUA + Communication 2021/C 528/01 Annex III',
          source_dataset: `carbon_cost_exposure ${r.methodology_version}`,
          retrieved_at: r.computed_at, quality_flag: 'ok',
        }))}
        right={carbonOption && <Legend items={geoLegend(carbonOption.geos, theme)} />}>
        {carbonOption ? <EChart option={carbonOption.option} height={240} theme={theme} />
          : <EmptyState>Awaiting EUA data.</EmptyState>}
      </Card>

      <SectionHeading title="Full ECU cost"
        subtitle="From the electricity bill to the whole plant-gate cost, and the labour data behind the fixed costs." />
      <EcuEconomicsCard theme={theme} memberMode={memberMode} fromDate={fromDate} />
      <LabourCard theme={theme} memberMode={memberMode} />
    </>
  )
}
