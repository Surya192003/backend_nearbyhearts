import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiCouple } from '../types.js'

async function getCoupleId(userId: string): Promise<string | null> {
  const r = await pool.query<{ couple_id: string }>(
    'SELECT couple_id FROM user_couples WHERE user_id = $1',
    [userId],
  )
  return r.rows[0]?.couple_id ?? null
}

export async function coupleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/couple', { preHandler: requiresAuth }, async (req, reply) => {
    const coupleId = await getCoupleId(req.userId!)
    if (!coupleId) return reply.code(404).send({ error: 'Not paired yet.' })
    const r = await pool.query<{ id: string; together_since: Date | null }>(
      `SELECT id, together_since FROM couples WHERE id = $1`,
      [coupleId],
    )
    const row = r.rows[0]!
    return {
      id: row.id,
      togetherSince: row.together_since?.toISOString() ?? null,
    } satisfies ApiCouple
  })

  app.patch<{ Body: { togetherSince?: string | null } }>(
    '/couple',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired yet.' })
      const { togetherSince } = req.body ?? ({} as never)
      if (togetherSince === undefined) {
        return reply.code(400).send({ error: 'Nothing to update.' })
      }
      await pool.query(`UPDATE couples SET together_since = $1 WHERE id = $2`, [
        togetherSince ? new Date(togetherSince) : null,
        coupleId,
      ])
      const r = await pool.query<{ id: string; together_since: Date | null }>(
        `SELECT id, together_since FROM couples WHERE id = $1`,
        [coupleId],
      )
      const row = r.rows[0]!
      return {
        id: row.id,
        togetherSince: row.together_since?.toISOString() ?? null,
      } satisfies ApiCouple
    },
  )
}