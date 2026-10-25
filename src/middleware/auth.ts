
import type { FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { hashToken } from '../auth.js'
import { config } from '../config.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
  }
}

export async function attachUser(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  req.userId = undefined

  const cookieName = config.sessionCookie.name
  const token = req.cookies?.[cookieName]

  if (!token) {
    req.log.info(
      { path: req.url, cookieName },
      'AUTH: session cookie not received',
    )
    return
  }

  try {
    const tokenHash = hashToken(token)

    const result = await pool.query<{ user_id: string }>(
      `SELECT user_id
       FROM sessions
       WHERE token_hash = $1
         AND expires_at > now()
       LIMIT 1`,
      [tokenHash],
    )

    const session = result.rows[0]

    if (!session) {
      req.log.warn(
        { path: req.url, cookieName },
        'AUTH: cookie received but session is invalid or expired',
      )
      return
    }

    req.userId = session.user_id

    req.log.debug(
      { path: req.url },
      'AUTH: session validated',
    )
  } catch (err) {
    req.log.error(
      { err, path: req.url },
      'AUTH: database session lookup failed',
    )
  }
}

export async function requiresAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.userId) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}
