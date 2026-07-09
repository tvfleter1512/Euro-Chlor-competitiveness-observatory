import React, { useEffect, useMemo, useState } from 'react'
import { fetchSeries, fetchIndicators } from '../api'
import { useTheme, GEO_LABEL } from '../theme'
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
    ]).then(([prod, util, stocks, gas, margin, cn]) => {
      setData({
        prod: prod.rows, util: util.rows, stocks: stocks.rows, gas: gas.rows,
        margin: margin.rows.filter(r => !fromDate || r.period_start >= fromDate),
        cn: cn.rows,
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
      </div>
    </>
  )
}
