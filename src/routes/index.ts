import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { authRoutes } from './auth.js'
import { userRoutes } from './users.js'
import { pairRoutes } from './pair.js'
import { coupleRoutes } from './couple.js'
import { visitRoutes } from './visits.js'
import { feedRoutes } from './feed.js'
import { messageRoutes } from './messages.js'
import { giftRoutes } from './gifts.js'
import { donationRoutes } from './donations.js'

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let db = false
    let dbError: string | null = null
    try {
      const r = await pool.query<{ ok: number }>('SELECT 1 AS ok')
      db = r.rows[0]?.ok === 1
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err)
    }
    return { ok: true, db, dbError, time: new Date().toISOString() }
  })

  app.post('/admin/cleanup', async (req, reply) => {
  // In prod, guard with a shared secret header. For now, dev-only.
  if (process.env.NODE_ENV === 'production') {
    return reply.code(403).send({ error: 'Disabled' })
  }
  const { cleanupExpired } = await import('../cleanup.js')
  return cleanupExpired()
})

  await authRoutes(app)
  await userRoutes(app)
  await pairRoutes(app)
  await coupleRoutes(app)
  await visitRoutes(app)
  await feedRoutes(app)
  await messageRoutes(app)
  await giftRoutes(app)
  await donationRoutes(app)
  await coupleRoutes(app)
}