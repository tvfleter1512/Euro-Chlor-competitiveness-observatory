import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchCapacityEvents, fetchFx } from '../api'
import { useTheme, GEO_LABEL, GEO_SLOT } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, Segmented, SectionHeading, StatTile, grid2 } from '../components'

const LYE_DRY_FACTOR = 2.0      // conversions.yaml: 50% lye -> 100% NaOH price basis
const CN_SPOT_DRY_FACTOR = 100 / 32   // SunSirs quotes 32% ion-membrane
const GEO = 'EU27_EFTA_UK'

// monthly unit value €/t from value+quantity rows; volume floor keeps
// thin-flow months from producing absurd unit values
function uvMap(valRows, qtyRows, flow, factor = 1, floorT = 500) {
  const val = new Map(valRows.filter(r => r.flow === flow).map(r => [r.period, Number(r.value)]))
  const qty = new Map(qtyRows.filter(r => r.flow === flow).map(r => [r.period, Number(r.value)]))
  const out = new Map()
  for (const [p, v] of val) {
    const q = qty.get(p)
    if (q > floorT) out.set(p, v / q * factor)
  }
  return out
}

// SunSirs daily spot (RMB/t) -> monthly €/t at the ECB monthly rate
function cnMonthly(rows, fxCny, factor = 1) {
  const byMonth = new Map()
  for (const r of rows) {
    const m = r.period.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push(Number(r.value))
  }
  const out = new Map()
  for (const [m, vals] of byMonth) {
    const fx = fxCny[m] ?? Object.values(fxCny).at(-1)
    if (fx) out.set(m, (vals.reduce((a, b) => a + b, 0) / vals.length) * factor / fx)
  }
  return out
}

const fmtKt = v => `${(v / 1e3).toFixed(0)} kt`
const pct = d => d == null ? null : `${d >= 0 ? '' : '-'}${Math.abs(d).toFixed(1)} %`

export default function Market({ fromDate, memberMode }) {
  const theme = useTheme()
  const [data, setData] = useState(null)
  const [view, setView] = useState('production')   // market balance card
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      // freq M: the annual survey shares these series ids — never mix periodicities
      fetchSeries({ series_id: 'production.production', geo: GEO, from: fromDate, freq: 'M' }),
      fetchSeries({ series_id: 'production.utilisation', geo: GEO, from: fromDate, freq: 'M' }),
      fetchSeries({ series_id: 'production.caustic_stocks', geo: GEO, from: fromDate, freq: 'M' }),
      memberMode ? fetchSeries({ series_id: 'production.caustic_production', geo: GEO, from: fromDate, freq: 'M' })
                 : Promise.resolve({ rows: [] }),
      fetchSeries({ series_id: 'price.caustic_spot_cn', geo: 'CN' }),
      fetchSeries({ series_id: 'trade.value', geo: 'EU27_2020', partner: 'EXTRA_EU', product: '28151200', freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: 'EXTRA_EU', product: '28151200', freq: 'M', from: fromDate }),
      fetchFx('CNY'),
      fetchSeries({ series_id: 'trade.value', geo: 'EU27_2020', partner: 'EXTRA_EU', product: '39041000', freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: 'EXTRA_EU', product: '39041000', freq: 'M', from: fromDate }),
      fetchSeries({ series_id: 'price.pvc_spot_cn', geo: 'CN' }),
      fetchSeries({ series_id: 'demand.construction_output', from: fromDate }),
      fetchSeries({ series_id: 'demand.paper_production', from: fromDate }),
      fetchSeries({ series_id: 'demand.chemicals_production', from: fromDate }),
      fetchCapacityEvents(),
      fetchSeries({ series_id: 'price.ppi_domestic', from: fromDate }),
    ]).then(([prod, util, stocks, caustic, cn, lyeVal, lyeQty, fxCny, pvcVal, pvcQty, pvcCn, constr, paper, chem, events, ppi]) => {
      // member stocks carry band='TOTAL'; the public scrape has band=null —
      // prefer the member split's total when present, else the public rows
      const stockTotal = stocks.rows.some(r => r.band === 'TOTAL')
        ? stocks.rows.filter(r => r.band === 'TOTAL')
        : stocks.rows.filter(r => !r.band)
      setData({
        // public monthly chlorine; in member mode the survey vintage may sit alongside — one row per month
        prod: [...new Map(prod.rows.map(r => [r.period, r])).values()],
        util: util.rows.filter(r => !r.band), stocks: stockTotal,
        caustic: caustic.rows.filter(r => r.period.includes('-')),
        cn: cn.rows,
        fxCny: Object.fromEntries(fxCny.rows.map(r => [String(r.rate_date).slice(0, 7), Number(r.rate)])),
        lyeVal: lyeVal.rows, lyeQty: lyeQty.rows,
        pvcVal: pvcVal.rows, pvcQty: pvcQty.rows, pvcCn: pvcCn.rows,
        demand: { constr: constr.rows, paper: paper.rows, chem: chem.rows },
        events: events.events,
        ppi: ppi.rows,
      })
    }).catch(e => setError(String(e)))
  }, [fromDate, memberMode])

  const balanceOption = useMemo(() => {
    if (!data) return null
    const base = baseOption(theme)
    const defs = {
      production: [
        ['Chlorine', data.prod, theme.series.s1],
        ...(data.caustic.length ? [['Caustic soda (member)', data.caustic, theme.series.s2]] : []),
      ],
      utilisation: [['Operating rate', data.util, theme.series.s1]],
      stocks: [['Caustic soda stocks', data.stocks, theme.series.s2]],
    }[view]
    const periods = [...new Set(defs.flatMap(([, rows]) => rows.map(r => r.period)))].sort()
    const isPct = view === 'utilisation'
    return {
      legend: defs.map(([name, , color]) => ({ label: name, color })),
      option: {
        ...base,
        grid: { ...base.grid, left: 56 },
        xAxis: { ...base.xAxis, data: periods },
        yAxis: { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel,
                 formatter: v => isPct ? `${v} %` : `${(v / 1e3).toFixed(0)} kt` } },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : isPct ? `${Number(v).toFixed(1)} %` : fmtKt(v) },
        series: defs.map(([name, rows, color]) => {
          const m = new Map(rows.map(r => [r.period, Number(r.value)]))
          return lineSeries(name, periods.map(p => m.get(p) ?? null), color, theme)
        }),
      },
    }
  }, [data, view, theme])

  // caustic and PVC price charts share one monthly x-axis so they read side by side
  const prices = useMemo(() => {
    if (!data) return null
    const caustic = {
      exp: uvMap(data.lyeVal, data.lyeQty, 'export', LYE_DRY_FACTOR),
      imp: uvMap(data.lyeVal, data.lyeQty, 'import', LYE_DRY_FACTOR),
      cn: cnMonthly(data.cn, data.fxCny, CN_SPOT_DRY_FACTOR),
    }
    const pvc = {
      exp: uvMap(data.pvcVal, data.pvcQty, 'export'),
      imp: uvMap(data.pvcVal, data.pvcQty, 'import'),
      cn: cnMonthly(data.pvcCn, data.fxCny),
    }
    const fromMonth = fromDate ? fromDate.slice(0, 7) : '0000'
    const periods = [...new Set([caustic, pvc].flatMap(s => Object.values(s).flatMap(m => [...m.keys()])))]
      .filter(p => p >= fromMonth).sort()
    const base = baseOption(theme)
    const option = s => ({
      ...base,
      xAxis: { ...base.xAxis, data: periods },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(0)} €/t` },
      series: [
        lineSeries('EU export UV', periods.map(p => s.exp.get(p) ?? null), theme.series.s1, theme),
        lineSeries('EU import UV', periods.map(p => s.imp.get(p) ?? null), theme.series.s8, theme),
        lineSeries('China spot', periods.map(p => s.cn.get(p) ?? null), theme.series.s5, theme),
      ],
    })
    return { caustic: option(caustic), pvc: option(pvc) }
  }, [data, theme, fromDate])

  // EU domestic producer prices, other basic inorganic chemicals (C20.13); C20 dashed for context
  const ppi = useMemo(() => {
    if (!data?.ppi?.length) return null
    const base = baseOption(theme)
    const periods = [...new Set(data.ppi.map(r => r.period))].sort()
    const geos = ['EU27_2020', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']
      .filter(g => data.ppi.some(r => r.geo_id === g && r.band === 'C2013'))
    const grab = (g, band) => {
      const m = new Map(data.ppi.filter(r => r.geo_id === g && r.band === band).map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      legend: [...geos.map(g => ({ label: `${GEO_LABEL[g] || g}${g === 'EU27_2020' ? ' — inorganic basics' : ''}`, color: theme.series[GEO_SLOT[g]] })),
               { label: 'EU27 — all chemicals (dashed)', color: theme.inkMuted }],
      option: {
        ...base,
        xAxis: { ...base.xAxis, data: periods },
        tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : Number(v).toFixed(1) },
        series: [
          ...geos.map(g => ({ ...lineSeries(GEO_LABEL[g] || g, grab(g, 'C2013'), theme.series[GEO_SLOT[g]], theme),
                              lineStyle: { width: g === 'EU27_2020' ? 3 : 1.5, color: theme.series[GEO_SLOT[g]] } })),
          { ...lineSeries('EU27 all chemicals', grab('EU27_2020', 'C20'), theme.inkMuted, theme),
            lineStyle: { width: 1.5, color: theme.inkMuted, type: 'dashed' } },
          { type: 'line', data: [], markLine: { silent: true, symbol: 'none', data: [{ yAxis: 100 }],
              lineStyle: { color: theme.axis, type: 'dashed', width: 1 }, label: { show: false } } },
        ],
      },
    }
  }, [data, theme])

  const demandOption = useMemo(() => {
    if (!data?.demand) return null
    const { constr, paper, chem } = data.demand
    if (!constr.length && !paper.length && !chem.length) return null
    const base = baseOption(theme)
    const periods = [...new Set([...constr, ...paper, ...chem].map(r => r.period))].sort()
    const grab = rows => {
      const m = new Map(rows.map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      ...base,
      xAxis: { ...base.xAxis, data: periods },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : Number(v).toFixed(1) },
      series: [
        lineSeries('Construction (PVC demand)', grab(constr), theme.series.s1, theme),
        lineSeries('Paper (caustic demand)', grab(paper), theme.series.s2, theme),
        lineSeries('Chemicals (context)', grab(chem), theme.series.s5, theme),
        { type: 'line', data: [], markLine: {
            silent: true, symbol: 'none', data: [{ yAxis: 100 }],
            lineStyle: { color: theme.axis, type: 'dashed', width: 1 }, label: { show: false } } },
      ],
    }
  }, [data, theme])

  if (error) return <EmptyState>Failed to load: {error}</EmptyState>
  if (!data) return <EmptyState>Loading…</EmptyState>

  const last = rows => rows.length ? rows[rows.length - 1] : null
  const yearEarlier = (rows, l) => l && rows.find(r => r.period === `${Number(l.period.slice(0, 4)) - 1}${l.period.slice(4)}`)
  const yoy = rows => {
    const l = last(rows), prev = yearEarlier(rows, l)
    return prev ? (Number(l.value) / Number(prev.value) - 1) * 100 : null
  }
  const lp = last(data.prod), lu = last(data.util), ls = last(data.stocks), lcn = last(data.cn)
  const prodYoy = yoy(data.prod), stockYoy = yoy(data.stocks)
  const utilPrev = yearEarlier(data.util, lu)
  const utilDelta = lu && utilPrev ? Number(lu.value) - Number(utilPrev.value) : null
  const spark = rows => rows.slice(-24).map(r => Number(r.value))
  const priceLegend = <Legend items={[
    { label: 'EU export UV', color: theme.series.s1 },
    { label: 'EU import UV', color: theme.series.s8 },
    { label: 'China spot', color: theme.series.s5 },
  ]} />

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatTile icon="🏭" label="Chlorine production"
          value={lp ? fmtKt(Number(lp.value)) : null} note={lp ? `${lp.period} · vs year earlier` : ''}
          delta={pct(prodYoy)} deltaGood={prodYoy >= 0} spark={spark(data.prod)} />
        <StatTile icon="◎" label="Operating rate"
          value={lu ? `${Number(lu.value).toFixed(1)} %` : null}
          note={lu ? `${lu.period} · vs year earlier` : ''}
          delta={utilDelta != null ? `${utilDelta >= 0 ? '' : '-'}${Math.abs(utilDelta).toFixed(1)} pp` : null}
          deltaGood={utilDelta >= 0} spark={spark(data.util)} />
        <StatTile icon="🧪" label="Caustic soda stocks"
          value={ls ? fmtKt(Number(ls.value)) : null} note={ls ? `${ls.period} · vs year earlier` : ''}
          delta={pct(stockYoy)} deltaGood={stockYoy < 0} spark={spark(data.stocks)} />
        <StatTile icon="🇨🇳" label="China caustic spot"
          value={lcn ? `${Number(lcn.value).toFixed(0)} RMB/t` : null}
          note={lcn ? `${lcn.period} · 32% ion-membrane` : 'SunSirs — accumulating'} />
      </div>

      <SectionHeading title="Production" subtitle="EU-27 + Norway, Switzerland and the UK (Euro Chlor reporting area)." />
      <Card title="Market balance — production, operating rate, stocks"
        subtitle={{
          production: `Monthly tonnes. Chlorine from Euro Chlor public monthly statistics.${data.caustic.length ? ' Caustic soda production from the member survey (not published publicly).' : ''}`,
          utilisation: 'Monthly operating rate (production ÷ nameplate capacity), %. Idle capacity is the EU’s real substitution margin.',
          stocks: 'Caustic soda stocks at month end, tonnes (Euro Chlor monthly statistics). Rising stocks with falling production signal weak demand.',
        }[view]}
        sourceRows={{ production: [...data.prod, ...data.caustic], utilisation: data.util, stocks: data.stocks }[view]}
        right={<Segmented value={view} onChange={setView}
          options={[['production', 'production'], ['utilisation', 'operating rate'], ['stocks', 'caustic stocks']]} />}>
        {balanceOption.legend.length > 1 && <Legend items={balanceOption.legend} />}
        <EChart option={balanceOption.option} height={280} theme={theme} />
      </Card>

      <SectionHeading title="Prices" subtitle="EU trade unit values against the Chinese domestic spot price, € per tonne, same time axis." />
      <div style={grid2}>
        <Card title="Caustic soda"
          subtitle="€/t on 100% NaOH basis, monthly. EU lines = extra-EU lye trade unit values (mix effects; imports are CIF, freight included). China = SunSirs 32% spot ÷ 0.32, ECB monthly FX — history accumulates from July 2026 (SunSirs archive is paywalled)."
          sourceRows={[...data.lyeVal.slice(-1), ...data.cn.slice(-1)]}>
          {priceLegend}
          <EChart height={250} theme={theme} option={prices.caustic} />
        </Card>
        <Card title="PVC"
          subtitle="€/t, monthly, extra-EU trade in unmixed PVC (CN8 39041000). Unit values carry grade-mix effects; imports are CIF (freight included). China = SunSirs daily spot, ECB monthly FX — accumulates from July 2026 (archive paywalled)."
          sourceRows={[...data.pvcVal.slice(-1), ...data.pvcCn.slice(-1)]}>
          {priceLegend}
          <EChart height={250} theme={theme} option={prices.pvc} />
        </Card>
      </div>

      <Card title="EU producer prices — other basic inorganic chemicals"
        subtitle="Domestic output price index, 2021 = 100, monthly, not seasonally adjusted (Eurostat sts_inppd_m, NACE C20.13: chlorine, caustic soda, hydrochloric acid, chlorates and other inorganics). What EU producers charge at home, beyond the trade unit values above. Country gaps = Eurostat confidentiality."
        sourceRows={data.ppi}>
        {ppi ? (<><Legend items={ppi.legend} /><EChart option={ppi.option} height={260} theme={theme} /></>)
          : <EmptyState>No producer-price data yet.</EmptyState>}
      </Card>

      <SectionHeading title="Customers and capacity" subtitle="Demand from the industries that buy chlorine derivatives and caustic soda, and plant decisions worldwide." />
      <Card title="Customer industries"
        subtitle="EU27 output indices, 2021 = 100, seasonally adjusted (Eurostat STS). Falling demand can mask competitiveness moves in the trade balance."
        sourceRows={[...(data.demand?.constr || []), ...(data.demand?.paper || [])]}
        right={demandOption && <Legend items={[
          { label: 'Construction (PVC demand)', color: theme.series.s1 },
          { label: 'Paper (caustic demand)', color: theme.series.s2 },
          { label: 'Chemicals (context)', color: theme.series.s5 },
        ]} />}>
        {demandOption ? <EChart option={demandOption} height={260} theme={theme} />
          : <EmptyState>No demand data.</EmptyState>}
      </Card>

      <Card title="Capacity events"
        subtitle="Curated tracker: closures, curtailments, conversions, expansions. Each row links its source; entries pending human confirmation are marked ◐.">
        {data.events?.length ? <CapacityTable events={data.events} /> : <EmptyState>No events in config/capacity_events.yaml yet.</EmptyState>}
      </Card>
    </>
  )
}

export function CapacityTable({ events, compact = false }) {
  const theme = useTheme()
  const cell = { padding: '8px 10px', fontSize: 12.5, color: theme.ink, borderBottom: `1px solid ${theme.grid}` }
  const cols = compact ? ['Date', 'Region', 'Company / site', 'Type', 'kt/yr', '']
                       : ['Date', 'Region', 'Company / site', 'Type', 'Product', 'kt/yr', 'What happened', '']
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>
          {cols.map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5,
              color: theme.inkMuted, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', borderBottom: `1px solid ${theme.grid}` }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{e.confirmed ? '' : '◐ '}{e.date}</td>
              <td style={cell}>{e.region}</td>
              <td style={cell}><strong>{e.company}</strong> — {e.site}</td>
              <td style={{ ...cell, fontSize: 12, fontWeight: 650,
                           color: ['closure', 'curtailment'].includes(e.type) ? theme.bad
                                : e.type === 'conversion' ? theme.inkSecondary : theme.good }}>{e.type}</td>
              {!compact && <td style={{ ...cell, color: theme.inkSecondary }}>{e.product}</td>}
              <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{e.capacity_kt_yr ?? '—'}</td>
              {!compact && <td style={{ ...cell, fontSize: 12, color: theme.inkSecondary }}>{e.note}</td>}
              <td style={{ ...cell, fontSize: 12 }}>
                <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: theme.accentText }}>source ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
