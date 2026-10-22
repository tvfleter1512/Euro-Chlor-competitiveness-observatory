// Open trade alerts grouped for display: the header badge, the Overview and the
// Trade tab all count these groups, so the numbers always agree.
// one entry per kind/product/flow/partner: strongest (high first, then latest) alert leads
export function groupAlerts(rows) {
  const groups = new Map()
  for (const a of rows) {
    const key = `${a.kind}|${a.product_code}|${a.flow}|${a.partner_geo_id}`
    const g = groups.get(key)
    if (!g) { groups.set(key, { lead: a, periods: new Set([a.period]) }); continue }
    g.periods.add(a.period)
    const stronger = (a.severity === 'high' && g.lead.severity !== 'high') ||
      (a.severity === g.lead.severity && a.period > g.lead.period)
    if (stronger) g.lead = a
  }
  return [...groups.values()].sort((p, q) =>
    (p.lead.severity === q.lead.severity ? q.lead.period.localeCompare(p.lead.period)
      : p.lead.severity === 'high' ? -1 : 1))
}
