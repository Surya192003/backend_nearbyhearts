import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { randomInt } from 'node:crypto'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'

class RouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'RouteError'
    Object.setPrototypeOf(this, RouteError.prototype)   // FIX: reliable instanceof
  }
}

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'NH-'
  for (let i = 0; i < 6; i++) {
    code += alphabet[randomInt(alphabet.length)]
  }
  return code
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
    nextVisitAt: row.next_visit_at?.toISOString() ?? null,
    distanceKm: row.distance_km,
  }
}

function toPartner(row: PartnerRow) {
  return {
    id: row.partner_id,
    firstName: row.partner_first_name,
    lastName: row.partner_last_name,
    avatarUrl: row.partner_avatar_url,        // FIX: field name (was avatar_url)
    city: row.partner_city ?? '',             // FIX: null → ''
    timezone: row.partner_timezone,
    lastSeenAt: row.partner_last_seen_at.toISOString(),   // FIX: COALESCE makes this safe
  }
}

async function loadCoupleRow(userId: string): Promise<CoupleRow | null> {
  const result = await pool.query<CoupleRow>(
    `SELECT id, user_a_id, user_b_id,
            together_since, next_visit_at, distance_km
       FROM couples
      WHERE user_a_id = $1 OR user_b_id = $1
      LIMIT 1`,
    [userId],
  )
  return result.rows[0] ?? null
}

// IMPORTANT: this takes the VIEWER's id and joins to find the partner.
// Do not change the signature to take a partner id — the caller in
// /couple/join passes req.userId.
async function loadPartnerRow(viewerId: string): Promise<PartnerRow | null> {
  const result = await pool.query<PartnerRow>(
    `SELECT
       p.id         AS partner_id,
       p.first_name AS partner_first_name,
       p.last_name  AS partner_last_name,
       p.avatar_url AS partner_avatar_url,
       p.city       AS partner_city,
       p.timezone   AS partner_timezone,
       COALESCE(p.last_seen_at, p.created_at, NOW()) AS partner_last_seen_at
     FROM couples c
     JOIN users p
       ON p.id = CASE
         WHEN c.user_a_id = $1 THEN c.user_b_id
         ELSE c.user_a_id
       END
     WHERE c.user_a_id = $1 OR c.user_b_id = $1
     LIMIT 1`,
    [viewerId],
  )
  return result.rows[0] ?? null
}

function getErrorCode(err: unknown): string | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string'
  ) {
    return err.code
  }
  return undefined
}

export async function coupleRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /couple ----------
  app.get('/couple', { preHandler: requiresAuth }, async (req, reply) => {
    const row = await loadCoupleRow(req.userId!)
    if (!row) return reply.code(404).send({ error: 'Not paired yet.' })
    return toCouple(row, req.userId!)
  })

  // ---------- GET /couple/partner ----------
  app.get('/couple/partner', { preHandler: requiresAuth }, async (req, reply) => {
    const partner = await loadPartnerRow(req.userId!)
    if (!partner) return reply.code(404).send({ error: 'No partner yet.' })
    return toPartner(partner)
  })

  // ---------- PATCH /couple ----------
  app.patch<{
    Body: {
      togetherSince?: string | null
      nextVisitAt?: string | null
      distanceKm?: number | null
    }
  }>('/couple', { preHandler: requiresAuth }, async (req, reply) => {
    const userId = req.userId!
    const body = req.body ?? {}
    const row = await loadCoupleRow(userId)
    if (!row) return reply.code(404).send({ error: 'Not paired yet.' })

    const sets: string[] = []
    const params: unknown[] = [row.id]

    if (body.togetherSince !== undefined) {
      if (
        body.togetherSince !== null &&
        (
          typeof body.togetherSince !== 'string' ||          // FIX: type guard first
          !/^\d{4}-\d{2}-\d{2}$/.test(body.togetherSince) ||
          !Number.isFinite(Date.parse(`${body.togetherSince}T00:00:00Z`)) ||
          new Date(`${body.togetherSince}T00:00:00Z`).toISOString().slice(0, 10) !==
            body.togetherSince
        )
      ) {
        return reply.code(400).send({
          error: 'togetherSince must be a valid YYYY-MM-DD date or null.',
        })
      }
      sets.push(`together_since = $${params.length + 1}`)
      params.push(body.togetherSince)
    }

    if (body.nextVisitAt !== undefined) {
      if (
        body.nextVisitAt !== null &&
        (
          typeof body.nextVisitAt !== 'string' ||
          !Number.isFinite(Date.parse(body.nextVisitAt))
        )
      ) {
        return reply.code(400).send({
          error: 'nextVisitAt must be a valid date-time or null.',
        })
      }
      sets.push(`next_visit_at = $${params.length + 1}`)
      params.push(body.nextVisitAt === null ? null : new Date(body.nextVisitAt!))
    }

    if (body.distanceKm !== undefined) {
      if (
        body.distanceKm !== null &&
        (
          !Number.isInteger(body.distanceKm) ||
          body.distanceKm < 0 ||
          body.distanceKm > 20050
        )
      ) {
        return reply.code(400).send({
          error: 'distanceKm must be an integer between 0 and 20050, or null.',
        })
      }
      sets.push(`distance_km = $${params.length + 1}`)
      params.push(body.distanceKm)
    }

    if (sets.length === 0) return toCouple(row, userId)

    const updated = await pool.query<CoupleRow>(
      `UPDATE couples
          SET ${sets.join(', ')}
        WHERE id = $1
          AND (user_a_id = $${params.length + 1}
            OR user_b_id = $${params.length + 1})
        RETURNING id, user_a_id, user_b_id,
                  together_since, next_visit_at, distance_km`,
      [...params, userId],
    )

    if (!updated.rows[0]) {
      return reply.code(404).send({ error: 'Couple not found.' })
    }
    return toCouple(updated.rows[0], userId)
  })

  // ---------- POST /couple/invite ----------
  app.post('/couple/invite', { preHandler: requiresAuth }, async (req, reply) => {
    const userId = req.userId!
    const MAX_ATTEMPTS = 5

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let client: PoolClient | undefined
      let committed = false

      try {
        // FIX: pool.connect() inside try
        client = await pool.connect()
        await client.query('BEGIN')

        const locked = await client.query(
          'SELECT id FROM users WHERE id = $1 FOR UPDATE',
          [userId],
        )
        if (locked.rowCount === 0) {
          throw new RouteError(401, 'Account no longer exists.')
        }

        // FIX: restore "already partnered" check
        const coupled = await client.query(
          'SELECT id FROM couples WHERE user_a_id = $1 OR user_b_id = $1 LIMIT 1',
          [userId],
        )
        if ((coupled.rowCount ?? 0) > 0) {
          throw new RouteError(409, 'Already partnered.')
        }

        // FIX: filter used / consumed invites
        const active = await client.query<{ code: string; expires_at: Date }>(
          `SELECT code, expires_at
             FROM couple_invites
            WHERE creator_id = $1
              AND used_at IS NULL
              AND used_by_id IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1`,
          [userId],
        )

        if (active.rows[0]) {
          await client.query('COMMIT')
          committed = true
          return reply.code(200).send({
            code: active.rows[0].code,
            expiresAt: active.rows[0].expires_at.toISOString(),
          })
        }

        const code = generateCode()
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        const inserted = await client.query<{ code: string; expires_at: Date }>(
          `INSERT INTO couple_invites (creator_id, code, expires_at)
           VALUES ($1, $2, $3)
           RETURNING code, expires_at`,
          [userId, code, expiresAt],
        )

        await client.query('COMMIT')
        committed = true
        return reply.code(201).send({
          code: inserted.rows[0]!.code,
          expiresAt: inserted.rows[0]!.expires_at.toISOString(),
        })
      } catch (err) {
        if (client && !committed) {
          await client.query('ROLLBACK').catch(() => {})
        }

        if (err instanceof RouteError) {
          return reply.code(err.statusCode).send({ error: err.message })
        }

        // FIX: on final attempt, return a clean 409 instead of leaking 23505
        if (getErrorCode(err) === '23505') {
          if (attempt < MAX_ATTEMPTS) {
            req.log.warn({ attempt }, 'Invite code collision, retrying')
            continue
          }
          return reply.code(409).send({
            error: 'Could not generate a unique invite code. Please try again.',
          })
        }

        throw err
      } finally {
        client?.release()
      }
    }
  })

  // ---------- POST /couple/join ----------
  app.post<{ Body: { code: string } }>(
    '/couple/join',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const userId = req.userId!
      const rawCode = req.body?.code

      if (
        typeof rawCode !== 'string' ||
        !/^NH-[A-HJ-NP-Z2-9]{6}$/i.test(rawCode.trim())
      ) {
        return reply.code(400).send({
          error: 'Enter a valid invite code, such as NH-ABC123.',
        })
      }

      const normalized = rawCode.trim().toUpperCase()
      const client = await pool.connect()
      let inTransaction = false

      try {
        await client.query('BEGIN')
        inTransaction = true

        const inviteResult = await client.query<{
          id: string
          creator_id: string
        }>(
          `SELECT id, creator_id
             FROM couple_invites
            WHERE code = $1
              AND used_at IS NULL
              AND used_by_id IS NULL
              AND expires_at > now()
            FOR UPDATE`,
          [normalized],
        )

        const invite = inviteResult.rows[0]
        if (!invite) {
          throw new RouteError(404, 'Invite not found, already used, or expired.')
        }
        if (invite.creator_id === userId) {
          throw new RouteError(400, "You can't join your own invite.")
        }

        const lockedUsers = await client.query<{ id: string }>(
          `SELECT id FROM users
            WHERE id = ANY($1::uuid[])
            ORDER BY id
            FOR UPDATE`,
          [[userId, invite.creator_id]],
        )
        if (lockedUsers.rows.length !== 2) {
          throw new RouteError(404, 'One of these accounts no longer exists.')
        }

        const existingCouple = await client.query<{
          id: string
          user_a_id: string
          user_b_id: string
        }>(
          `SELECT id, user_a_id, user_b_id
             FROM couples
            WHERE user_a_id = ANY($1::uuid[])
               OR user_b_id = ANY($1::uuid[])
            LIMIT 1`,
          [[userId, invite.creator_id]],
        )

        if (existingCouple.rows[0]) {
          const c = existingCouple.rows[0]
          if (c.user_a_id === userId || c.user_b_id === userId) {
            throw new RouteError(409, 'You are already partnered.')
          }
          throw new RouteError(409, 'Your inviter is already partnered.')
        }

        const [userA, userB] =
          userId < invite.creator_id
            ? [userId, invite.creator_id]
            : [invite.creator_id, userId]

        await client.query(
          `INSERT INTO couples (user_a_id, user_b_id, together_since)
           VALUES ($1, $2, CURRENT_DATE)`,
          [userA, userB],
        )

        const consumed = await client.query(
          `UPDATE couple_invites
              SET used_by_id = $1, used_at = now()
            WHERE id = $2
              AND used_at IS NULL
              AND used_by_id IS NULL
              AND expires_at > now()
           RETURNING id`,
          [userId, invite.id],
        )
        if (!consumed.rows[0]) {
          throw new RouteError(409, 'This invitation has already been used or expired.')
        }

        await client.query('COMMIT')
        inTransaction = false
      } catch (err) {
        if (inTransaction) {
          await client.query('ROLLBACK').catch(() => {})
        }

        if (err instanceof RouteError) {
          return reply.code(err.statusCode).send({ error: err.message })
        }
        if (getErrorCode(err) === '23505') {
          return reply.code(409).send({
            error: 'A pairing conflict occurred. Refresh and try again.',
          })
        }
        req.log.error({ err }, 'Couple join failed')
        throw err
      } finally {
        client.release()
      }

      const partner = await loadPartnerRow(userId)
      if (!partner) {
        req.log.error({ userId }, 'Pairing committed but partner lookup failed')
        return reply.code(500).send({
          error: 'Pairing was saved. Refresh your account to load your partner.',
        })
      }
      return { partner: toPartner(partner) }
    },
  )
}