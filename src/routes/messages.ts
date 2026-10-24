import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiMessage } from '../types.js'

type MsgRow = {
  id: string
  sender_id: string
  text: string
  created_at: Date
  read_at: Date | null
  is_incognito: boolean
  expires_at: Date
}

const REGULAR_RETENTION = "60 days"
const INCOGNITO_RETENTION = "24 hours"

function mapMessage(r: MsgRow, coupleId: string): ApiMessage {
  return {
    id: r.id,
    conversationId: coupleId,
    senderId: r.sender_id,
    text: r.text,
    createdAt: r.created_at.toISOString(),
    status: r.read_at ? 'read' : 'sent',
    isIncognito: r.is_incognito,
    expiresAt: r.expires_at.toISOString(),
  }
}

async function getCoupleId(userId: string): Promise<string | null> {
  const r = await pool.query<{ couple_id: string }>(
    'SELECT couple_id FROM user_couples WHERE user_id = $1',
    [userId],
  )
  return r.rows[0]?.couple_id ?? null
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/messages', { preHandler: requiresAuth }, async (req, reply) => {
    const coupleId = await getCoupleId(req.userId!)
    if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
    const r = await pool.query<MsgRow>(
      `SELECT id, sender_id, text, created_at, read_at, is_incognito, expires_at
         FROM messages
        WHERE couple_id = $1
          AND expires_at > now()
        ORDER BY created_at ASC`,
      [coupleId],
    )
    return r.rows.map((m) => mapMessage(m, coupleId))
  })

  app.post<{ Body: { text: string; isIncognito?: boolean } }>(
    '/messages',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { text, isIncognito } = req.body ?? ({} as never)
      if (!text) return reply.code(400).send({ error: 'text required' })
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(400).send({ error: 'No couple found' })

      const retention = isIncognito ? INCOGNITO_RETENTION : REGULAR_RETENTION
      const r = await pool.query<MsgRow>(
        `INSERT INTO messages
           (couple_id, sender_id, text, is_incognito, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '${retention}')
         RETURNING id, sender_id, text, created_at, read_at, is_incognito, expires_at`,
        [coupleId, req.userId, text, isIncognito === true],
      )
      return mapMessage(r.rows[0]!, coupleId)
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/messages/:id',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
      const r = await pool.query(
        'DELETE FROM messages WHERE id = $1 AND couple_id = $2 RETURNING id',
        [req.params.id, coupleId],
      )
      if (!r.rows[0]) return reply.code(404).send({ error: 'Not found' })
      return { ok: true }
    },
  )

  app.delete('/messages', { preHandler: requiresAuth }, async (req, reply) => {
    const coupleId = await getCoupleId(req.userId!)
    if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
    const r = await pool.query(
      'DELETE FROM messages WHERE couple_id = $1',
      [coupleId],
    )
    return { ok: true, deleted: r.rowCount ?? 0 }
  })
}