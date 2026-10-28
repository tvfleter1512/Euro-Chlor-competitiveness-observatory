// Management entry point: a written 'what changed' summary, six headline numbers in
// tab order (costs -> trade -> market; each opens its tab), the latest trade alerts and
// capacity events.
import React, { useEffect, useState } from 'react'
import { fetchSeries, fetchIndicators, fetchAlerts, fetchCapacityEvents, fetchFx } from '../api'
import { useTheme } from '../theme'
import { Card, EmptyState, Headline, SectionHeading, StatTile, grid2 } from '../components'
import { fmtPeriod } from '../EChart'
import { groupAlerts } from '../alerts'
import { CapacityTable } from './Market'

const LYE = '28151200'
const CN_SPOT_DRY_FACTOR = 100 / 32   // SunSirs quotes 32% ion-membrane; lye trade is priced dry ×2
const LYE_DRY_FACTOR = 2.0
const KIND_LABEL = { trade_surge: 'Volume rise', trade_price_drop: 'Price drop' }
const pct = d => d == null || !Number.isFinite(d) ? null : `${d >= 0 ? '' : '-'}${Math.abs(d).toFixed(1)} %`
const sorted = rows => [...rows].sort((a, b) => a.period.localeCompare(b.period))
const settle = p => p.then(r => r.rows).catch(() => [])

export default function Overview({ memberMode, setTab, setProduct }) {
  const theme = useTheme()
  const [d, setD] = useState(null)

  useEffect(() => {
    Promise.all([
      settle(fetchIndicators({ indicator_id: 'cost_gap', comparator: 'US' })),
      memberMode ? settle(fetchIndicators({ indicator_id: 'ecu_cash_cost' }))
                 : settle(fetchIndicators({ indicator_id: 'ecu_margin_proxy' })),
      settle(fetchSeries({ series_id: 'production.utilisation', geo: 'EU27_EFTA_UK', freq: 'M' })),
      settle(fetchIndicators({ indicator_id: 'trade_balance', product: LYE })),
      fetchAlerts(6).then(a => a.rows).catch(() => []),
      settle(fetchSeries({ series_id: 'price.caustic_spot_cn', geo: 'CN' })),
      fetchCapacityEvents().then(e => e.events).catch(() => []),
      // licensed (Chlorine Institute): only served in member mode
      settle(fetchSeries({ series_id: 'production.utilisation', geo: 'US', freq: 'M' })),
      settle(fetchSeries({ series_id: 'trade.value', geo: 'EU27_2020', partner: 'EXTRA_EU', product: LYE, flow: 'import', freq: 'M' })),
      settle(fetchSeries({ series_id: 'trade.quantity', geo: 'EU27_2020', partner: 'EXTRA_EU', product: LYE, flow: 'import', freq: 'M' })),
      fetchFx('CNY').then(f => f.rows).catch(() => []),
    ]).then(([gap, ecu, util, balance, alerts, cn, events, utilUS, lyeVal, lyeQty, fxCny]) => setD({
      gap: sorted(gap), ecu: sorted(ecu), util: sorted(util.filter(r => !r.band)),
      balance: sorted(balance), alerts: groupAlerts(alerts), cn: sorted(cn), events,
      utilUS: sorted(utilUS.filter(r => !r.band)), lyeVal: sorted(lyeVal), lyeQty: sorted(lyeQty),
      fxCny: Object.fromEntries(fxCny.map(r => [String(r.rate_date).slice(0, 7), Number(r.rate)])),
    }))
  }, [memberMode])

  if (!d) return <EmptyState>Loading…</EmptyState>

  const last = rows => rows.at(-1)
  const prevOf = rows => rows.at(-2)
  const num = r => r == null ? null : Number(r.value)

  // cost gap: uncompensated €/t ECU, latest semester vs the one before
  const gapVal = r => r?.inputs?.components?.gap_uncompensated_eur_ecu ?? num(r)
  const g = last(d.gap), gp = prevOf(d.gap)

  // operating rate: latest month, change vs a year earlier in points
  const u = last(d.util)
  const uPrev = u && d.util.find(r => r.period === `${Number(u.period.slice(0, 4)) - 1}${u.period.slice(4)}`)
  const uDelta = u && uPrev ? num(u) - num(uPrev) : null

  // EU vs US operating rate, latest month both report (member view)
  const usBy = new Map(d.utilUS.map(r => [r.period, num(r)]))
  const both = [...d.util].reverse().find(r => usBy.has(r.period))
  const utilGap = both ? num(both) - usBy.get(both.period) : null
  const gapSpark = d.util.slice(-24).map(r => usBy.has(r.period) ? num(r) - usBy.get(r.period) : null)

  // China caustic spot vs EU import price, both € per tonne NaOH (public view)
  const cnMonth = new Map()
  for (const r of d.cn) {
    const m = r.period.slice(0, 7)
    cnMonth.set(m, [...(cnMonth.get(m) || []), num(r)])
  }
  const cnLastM = [...cnMonth.keys()].sort().at(-1)
  const fxLast = cnLastM && (d.fxCny[cnLastM] ?? Object.values(d.fxCny).at(-1))
  const cnEur = cnLastM && fxLast
    ? cnMonth.get(cnLastM).reduce((a, b) => a + b, 0) / cnMonth.get(cnLastM).length * CN_SPOT_DRY_FACTOR / fxLast : null
  const qty = new Map(d.lyeQty.map(r => [r.period, num(r)]))
  const impUv = [...d.lyeVal].reverse().map(r => ({ period: r.period, uv: qty.get(r.period) > 500 ? num(r) / qty.get(r.period) * LYE_DRY_FACTOR : null }))
    .find(x => x.uv != null)

  // net trade, caustic lye: last 12 months vs the 12 before (€)
  const sum = rows => rows.reduce((a, r) => a + Number(r.value), 0)
  const bal12 = sum(d.balance.slice(-12)), balPrev = sum(d.balance.slice(-24, -12))
  const balWindow = d.balance.length ? `${d.balance.at(-12)?.period ?? d.balance[0].period} → ${d.balance.at(-1).period}` : ''

  const e = last(d.ecu), ep = prevOf(d.ecu)
  const high = d.alerts.filter(a => a.lead.severity === 'high')
  const top = (high[0] || d.alerts[0])?.lead
  const ev = d.events[0]
  const updown = (a, b) => a > b ? 'up from' : a < b ? 'down from' : 'unchanged at'

  return (
    <>
      <SectionHeading title="What changed" subtitle="The latest reading of each signal, in plain words." />
      <Headline>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {g && <li><strong>Costs:</strong> EU plants paid <strong>€{Math.round(gapVal(g))} more per tonne</strong> of chlorine and caustic soda
            for electricity than US plants in {fmtPeriod(g.period)}{gp ? `, ${updown(gapVal(g), gapVal(gp))} €${Math.round(gapVal(gp))} in ${fmtPeriod(gp.period)}` : ''} (sites
            without carbon-cost compensation).</li>}
          <li><strong>Trade:</strong> {d.alerts.length ? <>{d.alerts.length} import or price signals in the last 6 months, {high.length} high
            {top && <>; strongest: <strong>{top.product_name}</strong> {top.flow === 'import' ? 'from' : 'to'} {top.partner_geo_id === 'EXTRA_EU' ? 'all extra-EU partners' : top.partner_name} ({(KIND_LABEL[top.kind] || top.kind).toLowerCase()}, {top.period})</>}.</>
            : 'no import or price signals in the last 6 months.'}</li>
          {u && <li><strong>Market:</strong> EU plants ran at <strong>{num(u).toFixed(1)} %</strong> of capacity in {u.period}
            {uDelta != null ? `, ${Math.abs(uDelta).toFixed(1)} points ${uDelta >= 0 ? 'above' : 'below'} a year earlier` : ''}
            {ev && <>; latest capacity event: {ev.type} at {ev.company}{ev.site ? `, ${ev.site}` : ''} ({ev.date})</>}.</li>}
        </ul>
      </Headline>

      <SectionHeading title="Headline indicators"
        subtitle="In the order of the tabs: costs, trade, market. Click a tile to open the detail." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
                    gap: 16, marginBottom: 24 }}>
        <StatTile icon="⚡" label="Electricity cost gap vs US"
          value={g ? `€${Math.round(gapVal(g))} /t ECU` : null}
          note={g ? `${fmtPeriod(g.period)} · vs previous half-year · sites without carbon compensation` : 'no data'}
          delta={g && gp ? pct((gapVal(g) / gapVal(gp) - 1) * 100) : null} deltaGood={g && gp && gapVal(g) < gapVal(gp)}
          spark={d.gap.slice(-12).map(gapVal)} onClick={() => setTab('Costs')} />
        <StatTile icon="€" label={memberMode ? 'ECU cash cost, as paid (member)' : 'ECU margin over electricity'}
          value={e ? `€${Math.round(num(e))} /t` : null}
          note={e ? (memberMode ? `${e.period} · DE/FR/BE/ES, Argus non-power costs` : `${fmtPeriod(e.period)} · export prices − power bill`) : 'no data'}
          delta={e && ep ? pct((num(e) / num(ep) - 1) * 100) : null}
          deltaGood={e && ep && (memberMode ? num(e) < num(ep) : num(e) > num(ep))}
          spark={d.ecu.slice(-12).map(num)} onClick={() => setTab('Costs')} />
        <StatTile icon="⚖" label="Net trade, caustic soda lye"
          value={d.balance.length ? `${(bal12 / 1e6).toFixed(0)} M€` : null}
          note={d.balance.length ? `12 months, extra-EU · ${balWindow}` : 'no data'}
          delta={balPrev ? pct((bal12 - balPrev) / Math.abs(balPrev) * 100) : null} deltaGood={bal12 >= balPrev}
          spark={d.balance.slice(-24).map(num)}
          onClick={() => { setProduct(LYE); setTab('Trade') }} />
        <StatTile icon="!" label="Open trade alerts"
          value={String(d.alerts.length)}
          note={`${high.length} high · all products, last 6 months`}
          onClick={() => setTab('Trade')} />
        <StatTile icon="◎" label="EU chlor-alkali operating rate"
          value={u ? `${num(u).toFixed(1)} %` : null}
          note={u ? `${u.period} · vs year earlier` : 'no data'}
          delta={uDelta != null ? `${uDelta >= 0 ? '' : '-'}${Math.abs(uDelta).toFixed(1)} pp` : null}
          deltaGood={uDelta >= 0} spark={d.util.slice(-24).map(num)} onClick={() => setTab('Market')} />
        {utilGap != null ? (
          <StatTile icon="◑" label="Operating rate, EU minus US (member)"
            value={`${utilGap >= 0 ? '+' : '−'}${Math.abs(utilGap).toFixed(1)} pp`}
            note={`${both.period} · EU ${num(both).toFixed(1)} % vs US ${usBy.get(both.period).toFixed(1)} %`}
            spark={gapSpark} onClick={() => setTab('Members')} />
        ) : (
          <StatTile icon="🇨🇳" label="Caustic soda: China spot vs EU import price"
            value={cnEur ? `€${Math.round(cnEur)} /t` : null}
            note={cnEur ? `China ${cnLastM}${impUv ? ` · EU imports €${Math.round(impUv.uv)}/t (${impUv.period})` : ''} · 100 % NaOH` : 'SunSirs — accumulating'}
            onClick={() => setTab('Market')} />
        )}
      </div>

      <div style={grid2}>
        <Card title="Latest trade alerts"
          subtitle="Strongest signal per product, flow and partner. Click a row for the trade detail."
          right={<button onClick={() => setTab('Trade')} style={linkBtn(theme)}>All alerts →</button>}>
          {d.alerts.length ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {d.alerts.slice(0, 7).map(({ lead: a }) => (
                <div key={`${a.kind}${a.product_code}${a.flow}${a.partner_geo_id}`}
                     onClick={() => { setProduct(a.product_code); setTab('Trade') }}
                     style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0',
                              borderBottom: `1px solid ${theme.grid}`, cursor: 'pointer', fontSize: 12.5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                                 color: a.severity === 'high' ? theme.status.critical : theme.status.warning,
                                 width: 52, flexShrink: 0 }}>{a.severity}</span>
                  <span style={{ flex: 1, color: theme.ink }}>
                    <strong>{a.product_name}</strong>{' '}
                    <span style={{ color: theme.inkSecondary }}>
                      {a.flow === 'import' ? 'from' : 'to'} {a.partner_geo_id === 'EXTRA_EU' ? 'all extra-EU' : a.partner_name}
                    </span>
                  </span>
                  <span style={{ color: theme.inkSecondary, whiteSpace: 'nowrap' }}>{KIND_LABEL[a.kind] || a.kind}</span>
                  <span style={{ color: theme.inkMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{a.period}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState>No open alerts in the last 6 months.</EmptyState>}
        </Card>

        <Card title="Latest capacity events"
          subtitle="Closures, curtailments, conversions and expansions worldwide."
          right={<button onClick={() => setTab('Market')} style={linkBtn(theme)}>All events →</button>}>
          {d.events.length ? <CapacityTable events={d.events.slice(0, 6)} compact />
            : <EmptyState>No events yet.</EmptyState>}
        </Card>
      </div>
    </>
  )
}

const linkBtn = theme => ({
  background: 'none', border: 'none', color: theme.accentText, fontWeight: 650, fontSize: 12.5,
  cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
})
