
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import { geocodeAddress } from '../geocode.js'

type CurrentRow = {
  city: string | null
  state: string | null
  country: string | null
  timezone: string | null
}

type UpdatedUserRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  avatar_url: string | null
  city: string | null
  state: string | null
  country: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
  last_seen_at: Date
}

export async function userRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.patch<{
    Body: {
      city?: string
      state?: string | null
      country?: string
      timezone?: string
    }
  }>(
    '/users/me',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const userId = req.userId!
      const body = req.body ?? {}

      // Validate request values before using string methods.
      if (
        body.city !== undefined &&
        typeof body.city !== 'string'
      ) {
        return reply.code(400).send({
          error: 'City must be a string.',
        })
      }

      if (
        body.state !== undefined &&
        body.state !== null &&
        typeof body.state !== 'string'
      ) {
        return reply.code(400).send({
          error: 'State must be a string or null.',
        })
      }

      if (
        body.country !== undefined &&
        typeof body.country !== 'string'
      ) {
        return reply.code(400).send({
          error: 'Country must be a string.',
        })
      }

      if (
        body.timezone !== undefined &&
        typeof body.timezone !== 'string'
      ) {
        return reply.code(400).send({
          error: 'Timezone must be a string.',
        })
      }

      // Load current values so partial updates preserve other fields.
      const current = await pool.query<CurrentRow>(
        `SELECT city, state, country,
                COALESCE(timezone, 'UTC') AS timezone
           FROM users
          WHERE id = $1`,
        [userId],
      )

      const cur = current.rows[0]

      if (!cur) {
        return reply.code(404).send({
          error: 'User not found.',
        })
      }

      const city = (
        body.city ?? cur.city ?? ''
      ).trim()

      const state =
        body.state !== undefined
          ? body.state === null
            ? null
            : body.state.trim() || null
          : cur.state

      const country = (
        body.country ?? cur.country ?? ''
      ).trim()

      const timezone = (
        body.timezone ?? cur.timezone ?? 'UTC'
      ).trim()

      if (!city || !country) {
        return reply.code(400).send({
          error: 'City and country are required.',
        })
      }

      if (!timezone) {
        return reply.code(400).send({
          error: 'Timezone is required.',
        })
      }

      // Validate the IANA timezone.
      try {
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
        })
      } catch {
        return reply.code(400).send({
          error: 'Invalid timezone.',
        })
      }

      // Geocoding is optional: save the address even if geocoding fails.
      let coords: { lat: number; lng: number } | null = null
      let geocodeFailed = false

      try {
        coords = await geocodeAddress(city, state, country)
      } catch (err) {
        geocodeFailed = true

        req.log.warn(
          { err },
          'Geocoding failed while updating user location',
        )
      }

      const lat = coords?.lat ?? null
      const lng = coords?.lng ?? null

      // Save the address and its coordinates, if available.
      await pool.query(
        `UPDATE users
            SET city = $1,
                state = $2,
                country = $3,
                timezone = $4,
                latitude = $5,
                longitude = $6,
                updated_at = now()
          WHERE id = $7`,
        [city, state, country, timezone, lat, lng, userId],
      )

      // Reload the updated user.
      const updated = await pool.query<UpdatedUserRow>(
        `SELECT id,
                email,
                first_name,
                last_name,
                avatar_url,
                city,
                state,
                country,
                COALESCE(timezone, 'UTC') AS timezone,
                latitude,
                longitude,
                last_seen_at
           FROM users
          WHERE id = $1`,
        [userId],
      )

      const u = updated.rows[0]

      if (!u) {
        req.log.error(
          { userId },
          'User missing after profile update',
        )

        return reply.code(500).send({
          error: 'User not found after update.',
        })
      }

      return {
        user: {
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          avatarUrl: u.avatar_url,
          city: u.city ?? '',
          state: u.state,
          country: u.country,
          timezone: u.timezone,
          latitude: u.latitude,
          longitude: u.longitude,
          lastSeenAt: u.last_seen_at.toISOString(),

          // Keep these fields consistent with your existing API contract.
          // Load the actual relationship if the frontend requires it here.
          couple: null,
          partner: null,
        },
        geocoded: coords !== null,
        geocodeError:
          coords === null
            ? geocodeFailed
              ? 'The address could not be geocoded because the geocoding service failed. Your address was saved, but coordinates were not updated.'
              : 'Could not locate this address. Check the city and country spelling. Your address was saved, but coordinates were not updated.'
            : undefined,
      }
    },
  )
}
