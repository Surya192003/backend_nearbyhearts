import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'

type VisitRow = {
  id: string
  created_by: string
  title: string
  scheduled_at: Date
  status: 'scheduled' | 'cancel_pending' | 'cancelled' | 'completed'
  cancel_requested_by: string | null
  cancel_reason: string | null
  created_at: Date
  updated_at: Date
}

function mapVisit(v: VisitRow) {
  return {
    id: v.id,
    createdBy: v.created_by,
    title: v.title,
    scheduledAt: v.scheduled_at.toISOString(),
    status: v.status,
    cancelRequestedBy: v.cancel_requested_by,
    cancelReason: v.cancel_reason,
    createdAt: v.created_at.toISOString(),
    updatedAt: v.updated_at.toISOString(),
  }
}

async function getCoupleId(userId: string): Promise<string | null> {
  const r = await pool.query<{ couple_id: string }>(
    'SELECT couple_id FROM user_couples WHERE user_id = $1',
    [userId],
  )
  return r.rows[0]?.couple_id ?? null
}

async function getVisit(id: string, coupleId: string): Promise<VisitRow | null> {
  const r = await pool.query<VisitRow>(
    'SELECT * FROM visits WHERE id = $1 AND couple_id = $2',
    [id, coupleId],
  )
  return r.rows[0] ?? null
}

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  app.get('/visits', { preHandler: requiresAuth }, async (req, reply) => {
    const coupleId = await getCoupleId(req.userId!)
    if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
    const r = await pool.query<VisitRow>(
      `SELECT * FROM visits WHERE couple_id = $1 ORDER BY scheduled_at ASC`,
      [coupleId],
    )
    return r.rows.map(mapVisit)
  })

  app.post<{ Body: { title?: string; scheduledAt: string } }>(
    '/visits',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
      const { title, scheduledAt } = req.body ?? ({} as never)
      if (!scheduledAt) {
        return reply.code(400).send({ error: 'scheduledAt required' })
      }
      const d = new Date(scheduledAt)
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send({ error: 'Invalid date' })
      }
      const r = await pool.query<VisitRow>(
        `INSERT INTO visits (couple_id, created_by, title, scheduled_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [coupleId, req.userId, (title ?? 'Visit').trim() || 'Visit', d.toISOString()],
      )
      return mapVisit(r.rows[0]!)
    },
  )

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/visits/:id/cancel-request',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
      const v = await getVisit(req.params.id, coupleId)
      if (!v) return reply.code(404).send({ error: 'Visit not found' })
      if (v.status === 'cancelled') {
        return reply.code(409).send({ error: 'Already cancelled' })
      }
      if (v.status === 'cancel_pending') {
        return reply.code(409).send({ error: 'Cancellation already pending' })
      }
      if (new Date(v.scheduled_at) < new Date()) {
        return reply.code(409).send({ error: 'Visit is in the past' })
      }

      const reason = req.body?.reason?.trim() || null
      await pool.query(
        `UPDATE visits
            SET status = 'cancel_pending',
                cancel_requested_by = $1,
                cancel_reason = $2
          WHERE id = $3`,
        [req.userId, reason, req.params.id],
      )
      const updated = await getVisit(req.params.id, coupleId)
      return mapVisit(updated!)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/visits/:id/cancel-approve',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
      const v = await getVisit(req.params.id, coupleId)
      if (!v) return reply.code(404).send({ error: 'Visit not found' })
      if (v.status !== 'cancel_pending') {
        return reply.code(409).send({ error: 'No pending cancellation' })
      }
      if (v.cancel_requested_by === req.userId) {
        return reply
          .code(403)
          .send({ error: 'Your partner must approve this cancellation' })
      }
      await pool.query(`UPDATE visits SET status = 'cancelled' WHERE id = $1`, [
        req.params.id,
      ])
      const updated = await getVisit(req.params.id, coupleId)
      return mapVisit(updated!)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/visits/:id/cancel-reject',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
      const v = await getVisit(req.params.id, coupleId)
      if (!v) return reply.code(404).send({ error: 'Visit not found' })
      if (v.status !== 'cancel_pending') {
        return reply.code(409).send({ error: 'No pending cancellation' })
      }
      if (v.cancel_requested_by === req.userId) {
        return reply
          .code(403)
          .send({ error: 'Only your partner can reject this request' })
      }
      await pool.query(
        `UPDATE visits
            SET status = 'scheduled',
                cancel_requested_by = NULL,
                cancel_reason = NULL
          WHERE id = $1`,
        [req.params.id],
      )
      const updated = await getVisit(req.params.id, coupleId)
      return mapVisit(updated!)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/visits/:id/cancel-withdraw',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(404).send({ error: 'Not paired.' })
      const v = await getVisit(req.params.id, coupleId)
      if (!v) return reply.code(404).send({ error: 'Visit not found' })
      if (v.status !== 'cancel_pending') {
        return reply.code(409).send({ error: 'No pending cancellation' })
      }
      if (v.cancel_requested_by !== req.userId) {
        return reply
          .code(403)
          .send({ error: 'Only the requester can withdraw' })
      }
      await pool.query(
        `UPDATE visits
            SET status = 'scheduled',
                cancel_requested_by = NULL,
                cancel_reason = NULL
          WHERE id = $1`,
        [req.params.id],
      )
      const updated = await getVisit(req.params.id, coupleId)
      return mapVisit(updated!)
    },
  )
}