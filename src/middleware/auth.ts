import type { FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { hashToken } from '../auth.js'
import { config } from '../config.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
  }
}

/**
 * Runs on every request. Attaches `req.userId` if a valid session cookie
 * is present. Never throws — a broken DB is treated as "anonymous" so
 * routes that don't need auth (like /health) still respond.
 */
export async function attachUser(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = req.cookies?.[config.sessionCookie.name]
  if (!token) return

  try {
    const tokenHash = hashToken(token)
    const result = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
      [tokenHash],
    )
    const row = result.rows[0]
    if (row) req.userId = row.user_id
  } catch (err) {
    req.log.warn({ err }, 'attachUser: session lookup failed')
    // Swallow — treat as anonymous. Protected routes will 401, /health
    // will still respond so you can diagnose.
  }
}

export async function requiresAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.userId) {
    await reply.code(401).send({ error: 'Unauthorized' })
  }
}