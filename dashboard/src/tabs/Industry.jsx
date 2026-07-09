import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchCapacityEvents } from '../api'
import { useTheme, GEO_LABEL, GEO_SLOT } from '../theme'
import EChart, { baseOption, lineSeries } from '../EChart'
import { Card, EmptyState, Legend, StatTile } from '../components'

const fmtKt = v => `${(v / 1e3).toFixed(0)} kt`

function simpleLine({ rows, theme, color, unit, valueFmt, height = 240, markAt }) {
  const base = baseOption(theme)
  const data = [...rows].sort((a, b) => a.period.localeCompare(b.period))
  const option = {
    ...base,
    xAxis: { ...base.xAxis, data: data.map(r => r.period) },
    tooltip: { ...base.tooltip, valueFormatter: valueFmt },
    series: [
      lineSeries(unit, data.map(r => Number(r.value)), color, theme),
      ...(markAt != null ? [{
        type: 'line', data: [], markLine: {
          silent: true, symbol: 'none', data: [{ yAxis: markAt }],
          lineStyle: { color: theme.axis, type: 'dashed', width: 1 }, label: { show: false },
        },
      }] : []),
    ],
  }
  return <EChart option={option} height={height} theme={theme} />
}

export default function Industry({ fromDate }) {
  const theme = useTheme()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchSeries({ series_id: 'production.production', geo: 'EU27_EFTA_UK', from: fromDate }),
      fetchSeries({ series_id: 'production.utilisation', geo: 'EU27_EFTA_UK', from: fromDate }),
      fetchSeries({ series_id: 'production.caustic_stocks', geo: 'EU27_EFTA_UK', from: fromDate }),
      fetchSeries({ series_id: 'gas.hub_price', from: fromDate }),
      fetchIndicators({ indicator_id: 'ecu_margin_proxy' }),
      fetchSeries({ series_id: 'price.caustic_spot_cn', geo: 'CN' }),
      fetchSeries({ series_id: 'carbon.eua_price', from: fromDate }),
      fetchIndicators({ indicator_id: 'carbon_cost_exposure' }),
      fetchSeries({ series_id: 'demand.construction_output', from: fromDate }),
      fetchSeries({ series_id: 'demand.paper_production', from: fromDate }),
      fetchSeries({ series_id: 'demand.chemicals_production', from: fromDate }),
      fetchCapacityEvents(),
      fetchSeries({ series_id: 'structure.employment', band: 'C2013' }),
    ]).then(([prod, util, stocks, gas, margin, cn, eua, carbon, constr, paper, chem, events, emp]) => {
      setData({
        prod: prod.rows, util: util.rows, stocks: stocks.rows, gas: gas.rows,
        margin: margin.rows.filter(r => !fromDate || r.period_start >= fromDate),
        cn: cn.rows,
        eua: eua.rows,
        carbon: carbon.rows.filter(r => !fromDate || r.period_start >= fromDate),
        demand: { constr: constr.rows, paper: paper.rows, chem: chem.rows },
        events: events.events,
        employment: emp.rows,
      })
    }).catch(e => setError(String(e)))
  }, [fromDate])

  const gasOption = useMemo(() => {
    if (!data?.gas?.length) return null
    const base = baseOption(theme)
    const periods = [...new Set(data.gas.map(r => r.period))].sort()
    const grab = (geo) => {
      const m = new Map(data.gas.filter(r => r.geo_id === geo).map(r => [r.period, Number(r.value)]))
      return periods.map(p => m.get(p) ?? null)
    }
    return {
      ...base,
      xAxis: { ...base.xAxis, data: periods },
      tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} $/MMBtu` },
      series: [
        lineSeries('EU (TTF-based)', grab('EU27_2020'), theme.series.s1, theme),
        lineSeries('US Henry Hub', grab('US'), theme.series.s2, theme),
      ],
    }
  }, [data, theme])

  const demandOption = useMemo(() => {
    if (!data?.demand) return null
    const { constr, paper, chem } = data.demand
    if (!constr.length && !paper.length && !chem.length) return null
    const base = baseOption(theme)
    const periods = [...new Set([...constr, ...paper, ...chem].map(r => r.period))].sort()
    const grab = (rows) => {
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

  const last = (rows) => rows.length ? rows[rows.length - 1] : null
  const yoy = (rows) => {
    const l = last(rows)
    if (!l) return null
    const prev = rows.find(r => r.period === `${Number(l.period.slice(0, 4)) - 1}${l.period.slice(4)}`)
    return prev ? (Number(l.value) / Number(prev.value) - 1) * 100 : null
  }
  const pct = d => d == null ? null : `${d >= 0 ? '' : '-'}${Math.abs(d).toFixed(1)} %`

  const lp = last(data.prod), lu = last(data.util), ls = last(data.stocks)
  const lm = last(data.margin), lcn = last(data.cn)
  const prodYoy = yoy(data.prod)
  const utilLastYear = lu && data.util.find(r =>
    r.period === `${Number(lu.period.slice(0, 4)) - 1}${lu.period.slice(4)}`)
  const utilDelta = lu && utilLastYear ? Number(lu.value) - Number(utilLastYear.value) : null

  const srcEC = data.prod.slice(-1)
  const note = 'EU-27 + NO/CH/UK (Euro Chlor public monthly statistics)'

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatTile icon="🏭" label="Chlorine production"
          value={lp ? fmtKt(Number(lp.value)) : null} note={lp ? `${lp.period} · vs year earlier` : ''}
          delta={pct(prodYoy)} deltaGood={prodYoy >= 0} />
        <StatTile icon="◎" label="Capacity utilisation"
          value={lu ? `${Number(lu.value).toFixed(1)} %` : null}
          note={lu ? `${lu.period} · vs year earlier` : ''}
          delta={utilDelta != null ? `${utilDelta >= 0 ? '' : '-'}${Math.abs(utilDelta).toFixed(1)} pp` : null}
          deltaGood={utilDelta >= 0} />
        <StatTile icon="🧪" label="Caustic soda stocks"
          value={ls ? fmtKt(Number(ls.value)) : null} note={ls?.period}
          delta={pct(yoy(data.stocks))} deltaGood={yoy(data.stocks) < 0} />
        <StatTile icon="🇨🇳" label="China caustic spot"
          value={lcn ? `${Number(lcn.value).toFixed(0)} RMB/t` : null}
          note={lcn ? `${lcn.period} · 32% ion-membrane` : 'SunSirs — accumulating'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <Card title="EU chlorine production" subtitle={`Monthly tonnes, ${note}.`}
          sourceRows={data.prod}>
          {simpleLine({ rows: data.prod, theme, color: theme.series.s1, unit: 't Cl2',
                        valueFmt: v => `${(v / 1e3).toFixed(0)} kt` })}
        </Card>
        <Card title="Capacity utilisation" subtitle="Monthly operating rate, %. Idle capacity is the EU's real substitution margin (assessment §1.3)."
          sourceRows={data.util}>
          {simpleLine({ rows: data.util, theme, color: theme.series.s5, unit: '%',
                        valueFmt: v => `${Number(v).toFixed(1)} %` })}
        </Card>

        <Card title="Natural-gas hub prices — EU vs US"
          subtitle="Monthly, USD/MMBtu. The causal driver behind the electricity cost ratio."
          sourceRows={data.gas}
          right={<Legend items={[
            { label: 'EU (TTF-based)', color: theme.series.s1 },
            { label: 'US Henry Hub', color: theme.series.s2 },
          ]} />}>
          {gasOption ? <EChart option={gasOption} height={240} theme={theme} />
            : <EmptyState>No gas data.</EmptyState>}
        </Card>
        <Card title="ECU cash-margin proxy"
          subtitle="EUR per ECU, semi-annual. Public-data proxy (trade unit values − power cost); directional use only; params pending confirmation."
          sourceRows={data.margin?.map(r => ({
            source: 'Comext unit values + Eurostat power', source_dataset: 'ecu_margin_proxy v1.0',
            retrieved_at: r.computed_at, quality_flag: 'estimated',
          })).slice(-1)}>
          {data.margin?.length
            ? simpleLine({ rows: data.margin, theme, color: theme.series.s8, unit: 'EUR/ECU',
                           valueFmt: v => `${Number(v).toFixed(0)} €/ECU`, markAt: 0 })
            : <EmptyState>No margin series yet.</EmptyState>}
        </Card>

        <Card title="Caustic soda stocks" subtitle={`Monthly tonnes, ${note}.`}
          sourceRows={data.stocks}>
          {simpleLine({ rows: data.stocks, theme, color: theme.series.s2, unit: 't NaOH',
                        valueFmt: v => `${(v / 1e3).toFixed(0)} kt` })}
        </Card>
        <Card title="China caustic soda spot price"
          subtitle="Daily RMB/t, 32% ion-membrane (SunSirs). Series accumulates from July 2026 — page exposes only recent days."
          sourceRows={data.cn}>
          {data.cn?.length
            ? simpleLine({ rows: data.cn, theme, color: theme.series.s3, unit: 'RMB/t',
                           valueFmt: v => `${Number(v).toFixed(0)} RMB/t` })
            : <EmptyState>No SunSirs rows yet — runs daily via cron.</EmptyState>}
        </Card>

        <Card title="EUA carbon price" subtitle="Monthly average of daily secondary-market closes, EUR/tCO2 (ICAP)."
          sourceRows={data.eua}>
          {data.eua?.length
            ? simpleLine({ rows: data.eua, theme, color: theme.series.s5, unit: 'EUR/tCO2',
                           valueFmt: v => `${Number(v).toFixed(1)} €/tCO2` })
            : <EmptyState>No EUA data.</EmptyState>}
        </Card>
        <Card title="Indirect carbon cost per tonne Cl2 — by member state"
          subtitle="EUA × Annex III regional CO2 factor × 1.846 MWh/t × (1 − 80% aid). Net of MAX compensation — member states without compensation face 5× this. Constants cited to Communication 2021/C 528/01, confirmed."
          sourceRows={data.carbon?.slice(-1).map(r => ({
            source: 'ICAP EUA + Communication 2021/C 528/01 Annex III',
            source_dataset: `carbon_cost_exposure ${r.methodology_version}`,
            retrieved_at: r.computed_at, quality_flag: 'ok',
          }))}>
          {data.carbon?.length ? (() => {
            const base = baseOption(theme)
            const geos = ['DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL']
              .filter(g => data.carbon.some(r => r.geo_id === g))
            const periods = [...new Set(data.carbon.map(r => r.period))].sort()
            const grab = (g) => {
              const m = new Map(data.carbon.filter(r => r.geo_id === g)
                .map(r => [r.period, Number(r.value)]))
              return periods.map(p => m.get(p) ?? null)
            }
            return (
              <>
                <Legend items={geos.map(g => ({ label: GEO_LABEL[g] || g, color: theme.series[GEO_SLOT[g]] }))} />
                <EChart height={215} theme={theme} option={{
                  ...base,
                  xAxis: { ...base.xAxis, data: periods },
                  tooltip: { ...base.tooltip, valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(1)} €/t` },
                  series: geos.map(g =>
                    lineSeries(GEO_LABEL[g] || g, grab(g), theme.series[GEO_SLOT[g]], theme)),
                }} />
              </>
            )
          })() : <EmptyState>Awaiting EUA data.</EmptyState>}
        </Card>
      </div>

      <Card title="Employment — inorganic basic chemicals (NACE 20.13)"
        subtitle="Persons employed, EU27 + member-state detail, annual (Eurostat SBS; ~18-month lag). The 'jobs at stake' figure for position papers."
        sourceRows={data.employment}>
        {data.employment?.length ? (() => {
          const base = baseOption(theme)
          const eu = data.employment.filter(r => r.geo_id === 'EU27_2020')
            .sort((a, b) => a.period.localeCompare(b.period))
          const countries = [...new Set(data.employment.map(r => r.geo_id))]
            .filter(g => g !== 'EU27_2020')
          const latest = eu[eu.length - 1]
          return (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 700, color: theme.ink }}>
                  {Number(latest.value).toLocaleString('en')}
                </div>
                <div style={{ fontSize: 12, color: theme.inkSecondary }}>
                  persons, EU27, {latest.period}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 320 }}>
                <EChart height={140} theme={theme} option={{
                  ...base,
                  grid: { ...base.grid, top: 8, bottom: 22 },
                  xAxis: { ...base.xAxis, data: eu.map(r => r.period) },
                  tooltip: { ...base.tooltip, valueFormatter: v => Number(v).toLocaleString('en') },
                  series: [lineSeries('Employment', eu.map(r => Number(r.value)), theme.series.s1, theme)],
                }} />
              </div>
              <div style={{ fontSize: 11.5, color: theme.inkMuted, maxWidth: 220 }}>
                Country detail available for {countries.length} member states via the API
                (series structure.employment, band C2013).
              </div>
            </div>
          )
        })() : <EmptyState>Awaiting SBS data.</EmptyState>}
      </Card>

      <Card title="Demand-side indicators — customers vs competitiveness"
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
        subtitle="Curated tracker: closures, curtailments, conversions, expansions (assessment §2.5). Each row links its source; entries pending human confirmation are marked ◐.">
        {data.events?.length ? (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              {['Date', 'Region', 'Company / site', 'Type', 'Product', 'kt/yr', 'What happened', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5,
                  color: theme.inkMuted, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', borderBottom: `1px solid ${theme.grid}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.events.map((e, i) => (
                <tr key={i}>
                  <td style={{ padding: '8px 10px', fontSize: 12.5, color: theme.ink,
                               borderBottom: `1px solid ${theme.grid}`, fontVariantNumeric: 'tabular-nums',
                               whiteSpace: 'nowrap' }}>{e.confirmed ? '' : '◐ '}{e.date}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12.5, color: theme.ink,
                               borderBottom: `1px solid ${theme.grid}` }}>{e.region}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12.5, color: theme.ink,
                               borderBottom: `1px solid ${theme.grid}` }}>
                    <strong>{e.company}</strong> — {e.site}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 650,
                               borderBottom: `1px solid ${theme.grid}`,
                               color: ['closure', 'curtailment'].includes(e.type) ? theme.bad
                                    : e.type === 'conversion' ? theme.inkSecondary : theme.good }}>
                    {e.type}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12.5, color: theme.inkSecondary,
                               borderBottom: `1px solid ${theme.grid}` }}>{e.product}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12.5, color: theme.ink,
                               borderBottom: `1px solid ${theme.grid}`, fontVariantNumeric: 'tabular-nums' }}>
                    {e.capacity_kt_yr ?? '—'}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: theme.inkSecondary,
                               borderBottom: `1px solid ${theme.grid}` }}>{e.note}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12,
                               borderBottom: `1px solid ${theme.grid}` }}>
                    <a href={e.source_url} target="_blank" rel="noreferrer"
                       style={{ color: theme.accentText }}>source ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState>No events in config/capacity_events.yaml yet.</EmptyState>}
      </Card>
    </>
  )
}
