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
  couple_id: string
  partner_id: string
  partner_first_name: string
  partner_last_name: string
  partner_city: string | null
  partner_avatar_url: string | null
  partner_timezone: string
  partner_last_seen_at: Date
}

async function getCoupleRow(userId: string): Promise<CoupleRow | null> {
  const r = await pool.query<CoupleRow>(
    `SELECT
       c.id         AS couple_id,
       p.id         AS partner_id,
       p.first_name AS partner_first_name,
       p.last_name  AS partner_last_name,
       p.city       AS partner_city,
       p.avatar_url AS partner_avatar_url,
       p.timezone   AS partner_timezone,
       p.last_seen_at AS partner_last_seen_at
     FROM couples c
     JOIN users p
       ON p.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
     WHERE c.user_a_id = $1 OR c.user_b_id = $1`,
    [userId],
  )
  return r.rows[0] ?? null
}

function toPartner(row: CoupleRow) {
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

export async function coupleRoutes(app: FastifyInstance): Promise<void> {
  app.post('/couple/invite', { preHandler: requiresAuth }, async (req, reply) => {
    if (await getCoupleRow(req.userId!)) {
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
        // collision — loop and retry with a new code
      }
    }
    return reply.code(500).send({ error: 'Could not create invite' })
  })

  app.post<{ Body: { code: string } }>(
    '/couple/join',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { code } = req.body ?? ({} as never)
      if (!code) return reply.code(400).send({ error: 'code required' })

      if (await getCoupleRow(req.userId!)) {
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
      if (await getCoupleRow(inv.creator_id)) {
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

      const row = await getCoupleRow(me)
      if (!row) {
        return reply.code(500).send({ error: 'Couple created but not found' })
      }
      return { partner: toPartner(row) }
    },
  )
}