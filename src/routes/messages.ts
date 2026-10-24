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
}

function mapMessage(r: MsgRow, coupleId: string): ApiMessage {
  return {
    id: r.id,
    conversationId: coupleId,
    senderId: r.sender_id,
    text: r.text,
    createdAt: r.created_at.toISOString(),
    status: r.read_at ? 'read' : 'sent',
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
      `SELECT id, sender_id, text, created_at, read_at
         FROM messages
        WHERE couple_id = $1
        ORDER BY created_at ASC`,
      [coupleId],
    )
    return r.rows.map((m) => mapMessage(m, coupleId))
  })

  app.post<{ Body: { text: string } }>(
    '/messages',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { text } = req.body ?? ({} as never)
      if (!text) return reply.code(400).send({ error: 'text required' })
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
      const r = await pool.query<MsgRow>(
        `INSERT INTO messages (couple_id, sender_id, text)
         VALUES ($1, $2, $3)
         RETURNING id, sender_id, text, created_at, read_at`,
        [coupleId, req.userId, text],
      )
      return mapMessage(r.rows[0]!, coupleId)
    },
  )
}