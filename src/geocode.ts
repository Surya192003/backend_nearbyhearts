const USER_AGENT = 'NearbyHearts/1.0 (+https://nearbyhearts.app)'
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestAt
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed))
  }
  lastRequestAt = Date.now()
}

export type GeoPoint = { lat: number; lng: number }

/**
 * Geocode a free-text address using OpenStreetMap Nominatim.
 * Rate-limited to 1 req/sec. Returns null on failure (never throws for
 * "not found").
 */
export async function geocode(query: string): Promise<GeoPoint | null> {
  if (!query.trim()) return null
  await throttle()

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  const data = (await res.json()) as Array<{ lat: string; lon: string }>
  const first = data[0]
  if (!first) return null

  const lat = parseFloat(first.lat)
  const lng = parseFloat(first.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}