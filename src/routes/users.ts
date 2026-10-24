import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { geocode } from '../geocode.js'
import { requiresAuth } from '../middleware/auth.js'

type CurrentRow = {
  city: string | null
  state: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.patch<{
    Body: {
      city?: string
      state?: string | null
      country?: string
      timezone?: string
    }
  }>('/users/me', { preHandler: requiresAuth }, async (req, reply) => {
    const me = req.userId!
    const { city, state, country, timezone } = req.body ?? {}

    const cur = await pool.query<CurrentRow>(
      'SELECT city, state, country, latitude, longitude FROM users WHERE id = $1',
      [me],
    )
    const c = cur.rows[0]
    if (!c) return reply.code(404).send({ error: 'User not found' })

    const nextCity = city ?? c.city
    const nextState = state !== undefined ? state : c.state
    const nextCountry = country ?? c.country

    const addressChanged =
      nextCity !== c.city || nextState !== c.state || nextCountry !== c.country
    const canGeocode = Boolean(nextCity && nextCountry)
    const needsCoords = c.latitude === null || c.longitude === null

    let latitude: number | null = null
    let longitude: number | null = null
    let geocodeFailed = false

    if (canGeocode && (addressChanged || needsCoords)) {
      const query = [nextCity, nextState, nextCountry]
        .filter(Boolean)
        .join(', ')
      const point = await geocode(query)
      if (point) {
        latitude = point.lat
        longitude = point.lng
      } else {
        geocodeFailed = true
      }
    }

    const updates: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (city !== undefined) {
      updates.push(`city = $${idx++}`)
      values.push(city)
    }
    if (state !== undefined) {
      updates.push(`state = $${idx++}`)
      values.push(state)
    }
    if (country !== undefined) {
      updates.push(`country = $${idx++}`)
      values.push(country)
    }
    if (timezone !== undefined) {
      updates.push(`timezone = $${idx++}`)
      values.push(timezone)
    }
    if (latitude !== null) {
      updates.push(`latitude = $${idx++}`)
      values.push(latitude)
    }
    if (longitude !== null) {
      updates.push(`longitude = $${idx++}`)
      values.push(longitude)
    }

    if (updates.length > 0) {
      values.push(me)
      await pool.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${idx}`,
        values,
      )
    }

    return {
      ok: true,
      geocoded: !geocodeFailed && latitude !== null,
      geocodeError: geocodeFailed
        ? 'Could not find coordinates for this address. Try adding a country.'
        : undefined,
    }
  })
}