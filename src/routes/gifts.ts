import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiGift, ApiSentGift } from '../types.js'

type SentRow = {
  id: string
  gift_id: string
  from_user_id: string
  to_user_id: string
  note: string
  created_at: Date
}

async function getCouple(userId: string): Promise<{ id: string; partnerId: string } | null> {
  const r = await pool.query<{ couple_id: string; partner_id: string }>(
    'SELECT couple_id, partner_id FROM user_couples WHERE user_id = $1',
    [userId],
  )
  const row = r.rows[0]
  return row ? { id: row.couple_id, partnerId: row.partner_id } : null
}

export async function giftRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gifts', { preHandler: requiresAuth }, async () => {
    const r = await pool.query<ApiGift>(
      `SELECT id, name, emoji, price_cents AS "priceCents", blurb
         FROM gifts
        WHERE active = true
        ORDER BY price_cents ASC`,
    )
    return r.rows
  })

  app.get('/gifts/sent', { preHandler: requiresAuth }, async (req, reply) => {
    const couple = await getCouple(req.userId!)
    if (!couple) return reply.code(400).send({ error: 'No couple found' })
    const r = await pool.query<SentRow>(
      `SELECT id, gift_id, from_user_id, to_user_id, note, created_at
         FROM sent_gifts
        WHERE couple_id = $1
        ORDER BY created_at DESC`,
      [couple.id],
    )
    return r.rows.map<ApiSentGift>((s) => ({
      id: s.id,
      giftId: s.gift_id,
      fromUserId: s.from_user_id,
      toUserId: s.to_user_id,
      note: s.note,
      createdAt: s.created_at.toISOString(),
    }))
  })

  app.post<{ Body: { giftId: string; note: string } }>(
    '/gifts/send',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { giftId, note } = req.body ?? ({} as never)
      if (!giftId) return reply.code(400).send({ error: 'giftId required' })
      const couple = await getCouple(req.userId!)
      if (!couple) return reply.code(400).send({ error: 'No couple found' })

      const gift = await pool.query(
        'SELECT 1 FROM gifts WHERE id = $1 AND active = true',
        [giftId],
      )
      if (!gift.rows[0]) return reply.code(404).send({ error: 'Gift not found' })

      const r = await pool.query<SentRow>(
        `INSERT INTO sent_gifts (couple_id, gift_id, from_user_id, to_user_id, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, gift_id, from_user_id, to_user_id, note, created_at`,
        [couple.id, giftId, req.userId, couple.partnerId, note ?? ''],
      )
      const s = r.rows[0]!
      return {
        id: s.id,
        giftId: s.gift_id,
        fromUserId: s.from_user_id,
        toUserId: s.to_user_id,
        note: s.note,
        createdAt: s.created_at.toISOString(),
      } satisfies ApiSentGift
    },
  )
}