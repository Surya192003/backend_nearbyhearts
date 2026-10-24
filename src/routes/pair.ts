import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiPairRequest } from '../types.js'

type PendingRow = {
  id: string
  message: string | null
  created_at: Date
  from_id: string
  from_first_name: string
  from_last_name: string
  from_avatar_url: string | null
}

async function hasCouple(userId: string): Promise<boolean> {
  const r = await pool.query('SELECT 1 FROM user_couples WHERE user_id = $1 LIMIT 1', [userId])
  return r.rowCount !== null && r.rowCount > 0
}

export async function pairRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /pair/status
   * Returns current user's pair code, incoming requests, outgoing requests.
   * Does NOT include couple info — that's on /auth/me.
   */
  app.get('/pair/status', { preHandler: requiresAuth }, async (req) => {
    const me = req.userId!

    const [incoming, outgoing] = await Promise.all([
      pool.query<PendingRow>(
        `SELECT pr.id, pr.message, pr.created_at,
                u.id AS from_id,
                u.first_name AS from_first_name,
                u.last_name  AS from_last_name,
                u.avatar_url AS from_avatar_url
           FROM pair_requests pr
           JOIN users u ON u.id = pr.from_user_id
          WHERE pr.to_user_id = $1
          ORDER BY pr.created_at DESC`,
        [me],
      ),
      pool.query<PendingRow>(
        `SELECT pr.id, pr.message, pr.created_at,
                u.id AS from_id,
                u.first_name AS from_first_name,
                u.last_name  AS from_last_name,
                u.avatar_url AS from_avatar_url
           FROM pair_requests pr
           JOIN users u ON u.id = pr.to_user_id
          WHERE pr.from_user_id = $1
          ORDER BY pr.created_at DESC`,
        [me],
      ),
    ])

    const toRequest = (r: PendingRow): ApiPairRequest => ({
      id: r.id,
      fromUser: {
        id: r.from_id,
        firstName: r.from_first_name,
        lastName: r.from_last_name,
        avatarUrl: r.from_avatar_url,
      },
      message: r.message,
      createdAt: r.created_at.toISOString(),
    })

    return {
      incoming: incoming.rows.map(toRequest),
      outgoing: outgoing.rows.map(toRequest),
    }
  })

  /**
   * POST /pair/request { code, message? }
   */
  app.post<{ Body: { code: string; message?: string } }>(
    '/pair/request',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const me = req.userId!
      const { code, message } = req.body ?? ({} as never)
      if (!code || code.trim().length === 0) {
        return reply.code(400).send({ error: 'Pair code required' })
      }

      if (await hasCouple(me)) {
        return reply.code(409).send({ error: 'You are already paired.' })
      }

      const target = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE pair_code = $1`,
        [code.trim().toUpperCase()],
      )
      const targetId = target.rows[0]?.id
      if (!targetId) {
        return reply.code(404).send({ error: 'No user with that code.' })
      }
      if (targetId === me) {
        return reply.code(400).send({ error: "That's your own code." })
      }
      if (await hasCouple(targetId)) {
        return reply.code(409).send({ error: 'That user is already paired.' })
      }

      try {
        await pool.query(
          `INSERT INTO pair_requests (from_user_id, to_user_id, message)
           VALUES ($1, $2, $3)
           ON CONFLICT (from_user_id, to_user_id)
           DO UPDATE SET message = EXCLUDED.message, created_at = now()`,
          [me, targetId, message ?? null],
        )
      } catch {
        return reply.code(500).send({ error: 'Could not create request.' })
      }
      return { ok: true }
    },
  )

  /**
   * POST /pair/requests/:id/accept
   * Transactional. Creates couple, deletes ALL requests involving either user.
   */
  app.post<{ Params: { id: string } }>(
    '/pair/requests/:id/accept',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const me = req.userId!
      const { id } = req.params

      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const req_ = await client.query<{
          from_user_id: string
          to_user_id: string
        }>(
          `SELECT from_user_id, to_user_id FROM pair_requests WHERE id = $1`,
          [id],
        )
        const row = req_.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return reply.code(404).send({ error: 'Request not found.' })
        }
        if (row.to_user_id !== me) {
          await client.query('ROLLBACK')
          return reply.code(403).send({ error: 'Not your request to accept.' })
        }

        // Lock both users to prevent race
        const lock = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE id = ANY($1) FOR UPDATE`,
          [[row.from_user_id, row.to_user_id]],
        )
        if (lock.rowCount !== 2) {
          await client.query('ROLLBACK')
          return reply.code(500).send({ error: 'Users missing.' })
        }

        const coupled = await client.query(
          `SELECT 1 FROM couples
            WHERE user_a_id IN ($1, $2) OR user_b_id IN ($1, $2)
            LIMIT 1`,
          [row.from_user_id, row.to_user_id],
        )
        if (coupled.rowCount && coupled.rowCount > 0) {
          await client.query('ROLLBACK')
          return reply
            .code(409)
            .send({ error: 'One of you is already paired.' })
        }

        const a = row.from_user_id < row.to_user_id ? row.from_user_id : row.to_user_id
        const b = row.from_user_id < row.to_user_id ? row.to_user_id : row.from_user_id

        await client.query(
          `INSERT INTO couples (user_a_id, user_b_id) VALUES ($1, $2)`,
          [a, b],
        )

        // Remove every pair request involving either user
        await client.query(
          `DELETE FROM pair_requests
            WHERE from_user_id = ANY($1) OR to_user_id = ANY($1)`,
          [[row.from_user_id, row.to_user_id]],
        )

        await client.query('COMMIT')
        return { ok: true }
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  )

  /**
   * POST /pair/requests/:id/reject
   */
  app.post<{ Params: { id: string } }>(
    '/pair/requests/:id/reject',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const me = req.userId!
      const { id } = req.params
      const r = await pool.query(
        `DELETE FROM pair_requests
          WHERE id = $1 AND to_user_id = $2`,
        [id, me],
      )
      if (r.rowCount === 0) {
        return reply.code(404).send({ error: 'Request not found.' })
      }
      return { ok: true }
    },
  )

  /**
   * DELETE /pair/requests/:id  — sender cancels their own outgoing request
   */
  app.delete<{ Params: { id: string } }>(
    '/pair/requests/:id',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const me = req.userId!
      const { id } = req.params
      const r = await pool.query(
        `DELETE FROM pair_requests WHERE id = $1 AND from_user_id = $2`,
        [id, me],
      )
      if (r.rowCount === 0) {
        return reply.code(404).send({ error: 'Request not found.' })
      }
      return { ok: true }
    },
  )
}