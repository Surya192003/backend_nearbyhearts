type Coords = { lat: number; lng: number }

/**
 * Geocode "city, state, country" via OpenStreetMap Nominatim.
 * Free, no API key. Requires User-Agent per Nominatim TOS.
 * Returns null on failure — the caller should still save the address.
 */
export async function geocodeAddress(
  city: string,
  state: string | null,
  country: string,
): Promise<Coords | null> {
  const query = [city, state, country].filter(Boolean).join(', ')
  if (!query.trim()) return null

  const url =
    'https://nominatim.openstreetmap.org/search' +
    `?q=${encodeURIComponent(query)}` +
    '&format=json&limit=1'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NearbyHearts/1.0 (https://nearbyhearts.app)',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!data[0]) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}