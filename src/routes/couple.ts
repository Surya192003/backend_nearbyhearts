import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = 'NH-'
  for (let i = 0; i < 6; i += 1) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return s
}

type CoupleRow = {
  id: string
  user_a_id: string
  user_b_id: string
  together_since: Date | null
  next_visit_at: Date | null
  distance_km: number | null
}

type PartnerRow = {
  partner_id: string
  partner_first_name: string
  partner_last_name: string
  partner_avatar_url: string | null
  partner_city: string | null
  partner_timezone: string
  partner_last_seen_at: Date
}

function toCouple(row: CoupleRow, viewerId: string) {
  const isA = row.user_a_id === viewerId
  return {
    id: row.id,
    userId: viewerId,
    partnerId: isA ? row.user_b_id : row.user_a_id,
    togetherSince: row.together_since
      ? row.together_since.toISOString().slice(0, 10)
      : null,
    nextVisitAt: row.next_visit_at ? row.next_visit_at.toISOString() : null,
    distanceKm: row.distance_km,
  }
}

function toPartner(row: PartnerRow) {
  return {
    id: row.partner_id,
    firstName: row.partner_first_name,
    lastName: row.partner_last_name,
    avatarUrl: row.partner_avatar_url,
    city: row.partner_city ?? '',
    timezone: row.partner_timezone,
    lastSeenAt: row.partner_last_seen_at.toISOString(),
  }
}

async function loadCoupleRow(userId: string): Promise<CoupleRow | null> {
  const r = await pool.query<CoupleRow>(
    `SELECT id, user_a_id, user_b_id, together_since, next_visit_at, distance_km
       FROM couples
      WHERE user_a_id = $1 OR user_b_id = $1`,
    [userId],
  )
  return r.rows[0] ?? null
}

async function loadPartnerRow(userId: string): Promise<PartnerRow | null> {
  const r = await pool.query<PartnerRow>(
    `SELECT
       p.id           AS partner_id,
       p.first_name   AS partner_first_name,
       p.last_name    AS partner_last_name,
       p.avatar_url   AS partner_avatar_url,
       p.city         AS partner_city,
       p.timezone     AS partner_timezone,
       p.last_seen_at AS partner_last_seen_at
     FROM couples c
     JOIN users p
       ON p.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
     WHERE c.user_a_id = $1 OR c.user_b_id = $1`,
    [userId],
  )
  return r.rows[0] ?? null
}

export async function coupleRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /couple ----------
  app.get('/couple', { preHandler: requiresAuth }, async (req, reply) => {
    const row = await loadCoupleRow(req.userId!)
    if (!row) return reply.code(404).send({ error: 'Not paired yet.' })
    return toCouple(row, req.userId!)
  })

  // ---------- PATCH /couple ----------
  app.patch<{
    Body: {
      togetherSince?: string | null
      nextVisitAt?: string | null
      distanceKm?: number | null
    }
  }>('/couple', { preHandler: requiresAuth }, async (req, reply) => {
    const row = await loadCoupleRow(req.userId!)
    if (!row) return reply.code(404).send({ error: 'Not paired yet.' })

    const { togetherSince, nextVisitAt, distanceKm } = req.body ?? {}
    const sets: string[] = []
    const params: unknown[] = [row.id]

    if (togetherSince !== undefined) {
      sets.push(`together_since = $${params.length + 1}`)
      params.push(togetherSince ? new Date(togetherSince) : null)
    }
    if (nextVisitAt !== undefined) {
      sets.push(`next_visit_at = $${params.length + 1}`)
      params.push(nextVisitAt ? new Date(nextVisitAt) : null)
    }
    if (distanceKm !== undefined) {
      sets.push(`distance_km = $${params.length + 1}`)
      params.push(distanceKm)
    }
    if (sets.length === 0) return toCouple(row, req.userId!)

    const updated = await pool.query<CoupleRow>(
      `UPDATE couples SET ${sets.join(', ')}
        WHERE id = $1
        RETURNING id, user_a_id, user_b_id, together_since, next_visit_at, distance_km`,
      params,
    )
    return toCouple(updated.rows[0]!, req.userId!)
  })

  // ---------- POST /couple/invite ----------
  app.post('/couple/invite', { preHandler: requiresAuth }, async (req, reply) => {
    if (await loadCoupleRow(req.userId!)) {
      return reply.code(409).send({ error: 'Already partnered' })
    }

    const active = await pool.query<{ code: string; expires_at: Date }>(
      `SELECT code, expires_at FROM couple_invites
        WHERE creator_id = $1
          AND used_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [req.userId],
    )
    if (active.rows[0]) {
      return {
        code: active.rows[0].code,
        expiresAt: active.rows[0].expires_at.toISOString(),
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode()
      try {
        const r = await pool.query<{ code: string; expires_at: Date }>(
          `INSERT INTO couple_invites (creator_id, code)
           VALUES ($1, $2)
           RETURNING code, expires_at`,
          [req.userId, code],
        )
        return {
          code: r.rows[0]!.code,
          expiresAt: r.rows[0]!.expires_at.toISOString(),
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (!msg.includes('duplicate key') || attempt === 4) throw err
      }
    }
    return reply.code(500).send({ error: 'Could not create invite' })
  })

  // ---------- POST /couple/join ----------
  app.post<{ Body: { code: string } }>(
    '/couple/join',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { code } = req.body ?? ({} as never)
      if (!code) return reply.code(400).send({ error: 'code required' })

      if (await loadCoupleRow(req.userId!)) {
        return reply.code(409).send({ error: 'Already partnered' })
      }

      const normalized = code.trim().toUpperCase()
      const invite = await pool.query<{ id: string; creator_id: string }>(
        `SELECT id, creator_id FROM couple_invites
          WHERE code = $1
            AND used_at IS NULL
            AND expires_at > now()`,
        [normalized],
      )
      const inv = invite.rows[0]
      if (!inv) {
        return reply.code(404).send({ error: 'Invite not found or expired' })
      }
      if (inv.creator_id === req.userId) {
        return reply.code(400).send({ error: "You can't join your own invite" })
      }
      if (await loadCoupleRow(inv.creator_id)) {
        return reply.code(409).send({ error: 'Inviter is already partnered' })
      }

      const me = req.userId!
      const userA = inv.creator_id < me ? inv.creator_id : me
      const userB = inv.creator_id < me ? me : inv.creator_id

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO couples (user_a_id, user_b_id, together_since)
           VALUES ($1, $2, CURRENT_DATE)`,
          [userA, userB],
        )
        await client.query(
          `UPDATE couple_invites
              SET used_by_id = $1, used_at = now()
            WHERE id = $2`,
          [me, inv.id],
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      const partnerRow = await loadPartnerRow(me)
      if (!partnerRow) {
        return reply.code(500).send({ error: 'Couple created but partner missing' })
      }
      return { partner: toPartner(partnerRow) }
    },
  )
}