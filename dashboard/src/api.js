async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
  const resp = await fetch(`${path}?${qs}`)
  if (!resp.ok) throw new Error(`${path}: HTTP ${resp.status}`)
  return resp.json()
}

export const fetchSeries = (params) => get('/api/series', params)
export const fetchIndicators = (params) => get('/api/indicators', params)
export const fetchHealth = () => get('/api/health')
export const fetchProducts = () => get('/api/meta/products')
export const fetchRegions = () => get('/api/meta/regions')
export const fetchCapacityEvents = () => get('/api/meta/capacity-events')
