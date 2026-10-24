import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import type { ApiDonationReceipt } from '../types.js'

const BONUS_THRESHOLD_CENTS = 1000
const BONUS_PHOTOS = 10

export async function donationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { code: string; amountCents: number; donorName: string; message: string }
  }>('/donations', async (req, reply) => {
    const { code, amountCents, donorName, message } = req.body ?? ({} as never)
    if (!amountCents || amountCents <= 0) {
      return reply.code(400).send({ error: 'amountCents must be positive' })
    }
    if (!donorName) {
      return reply.code(400).send({ error: 'donorName required' })
    }

    const bonus =
      code === 'photobooth' && amountCents >= BONUS_THRESHOLD_CENTS
        ? BONUS_PHOTOS
        : 0

    // Optional session — attach user if signed in
    const userId = req.userId ?? null
    let coupleId: string | null = null
    if (userId) {
      const c = await pool.query<{ couple_id: string }>(
        'SELECT couple_id FROM user_couples WHERE user_id = $1',
        [userId],
      )
      coupleId = c.rows[0]?.couple_id ?? null
    }

    const r = await pool.query<{
      id: string
      amount_cents: number
      donor_name: string
      message: string
      created_at: Date
    }>(
      `INSERT INTO donations
         (user_id, couple_id, code, amount_cents, donor_name, message,
          status, bonus_photos_granted)
       VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7)
       RETURNING id, amount_cents, donor_name, message, created_at`,
      [
        userId,
        coupleId,
        code ?? 'general',
        amountCents,
        donorName,
        message ?? '',
        bonus,
      ],
    )
    const d = r.rows[0]!
    const receipt: ApiDonationReceipt = {
      id: d.id,
      amountCents: d.amount_cents,
      donorName: d.donor_name,
      message: d.message,
      createdAt: d.created_at.toISOString(),
    }
    return receipt
  })
}