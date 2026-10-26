import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { generateToken, hashToken, SESSION_TTL_DAYS } from '../auth.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiCouple, ApiPartner, ApiUser } from '../types.js'
import { config } from '../config.js'

async function loadUser(userId: string): Promise<ApiUser | null> {
  // ---- Query 1: base user ----
  const userRes = await pool.query<{
    id: string
    email: string
    first_name: string
    last_name: string
    avatar_url: string | null
    city: string | null
    timezone: string
    last_seen_at: Date
  }>(
    `SELECT id, email, first_name, last_name, avatar_url, city,
            COALESCE(timezone, 'UTC') AS timezone,
            last_seen_at
       FROM users
      WHERE id = $1`,
    [userId],
  )
  const u = userRes.rows[0]
  if (!u) return null

  // ---- Query 2: couple + partner via user_couples view ----
  const partnerRes = await pool.query<{
    couple_id: string
    together_since: Date | null
    partner_id: string
    partner_first_name: string
    partner_last_name: string
    partner_avatar_url: string | null
    partner_city: string | null
    partner_timezone: string
    partner_last_seen_at: Date
  }>(
    `SELECT
       uc.couple_id,
       c.together_since,
       p.id            AS partner_id,
       p.first_name    AS partner_first_name,
       p.last_name     AS partner_last_name,
       p.avatar_url    AS partner_avatar_url,
       p.city          AS partner_city,
       p.timezone      AS partner_timezone,
       p.last_seen_at  AS partner_last_seen_at
     FROM user_couples uc
     JOIN couples c ON c.id = uc.couple_id
     JOIN users p   ON p.id = uc.partner_id
     WHERE uc.user_id = $1
     LIMIT 1`,
    [userId],
  )
  const pr = partnerRes.rows[0]

  const partner: ApiPartner | null = pr
    ? {
        id: pr.partner_id,
        firstName: pr.partner_first_name,
        lastName: pr.partner_last_name,
        avatarUrl: pr.partner_avatar_url,
        city: pr.partner_city ?? '',
        timezone: pr.partner_timezone ?? 'UTC',
        lastSeenAt: (pr.partner_last_seen_at ?? new Date()).toISOString(),
      }
    : null

  const couple: ApiCouple | null = pr
    ? {
        id: pr.couple_id,
        togetherSince: pr.together_since
          ? pr.together_since.toISOString().slice(0, 10)
          : null,
      }
    : null

  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    avatarUrl: u.avatar_url,
    city: u.city ?? '',
    timezone: u.timezone,
    lastSeenAt: u.last_seen_at.toISOString(),
    couple,
    partner,
  }
}

async function issueSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000)
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  )
  return { token, expiresAt }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ---------- POST /auth/signup ----------
  app.post<{
    Body: {
      email: string
      password: string
      firstName: string
      lastName: string
      city?: string
    }
  }>('/auth/signup', async (req, reply) => {
    const body = req.body ?? ({} as never)
    const { email, password, firstName, lastName } = body
    if (!email || !password || !firstName || !lastName) {
      return reply
        .code(400)
        .send({ error: 'email, password, firstName, lastName required' })
    }
    if (password.length < 6) {
      return reply
        .code(400)
        .send({ error: 'Password must be at least 6 characters' })
    }

    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, first_name, last_name, city)
         VALUES ($1, crypt($2, gen_salt('bf', 10)), $3, $4, $5)
         RETURNING id`,
        [email, password, firstName, lastName, body.city ?? null],
      )
      const userId = r.rows[0]!.id
      const { token, expiresAt } = await issueSession(userId)

      reply.setCookie(config.sessionCookie.name, token, {
        ...config.sessionCookie,
        expires: expiresAt,
      })

      const user = await loadUser(userId)
      return { user }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '23505') {
        return reply.code(409).send({ error: 'Email already registered' })
      }
      throw err
    }
  })

  // ---------- POST /auth/signin ----------
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/signin',
    async (req, reply) => {
      const { email, password } = req.body ?? ({} as never)
      if (!email || !password) {
        return reply.code(400).send({ error: 'Email and password required' })
      }

      const result = await pool.query<{ id: string }>(
        `SELECT id FROM users
          WHERE email = $1
            AND password_hash = crypt($2, password_hash)`,
        [email, password],
      )
      const row = result.rows[0]
      if (!row) return reply.code(401).send({ error: 'Invalid credentials' })

      await pool.query(
        'UPDATE users SET last_seen_at = now() WHERE id = $1',
        [row.id],
      )

      const { token, expiresAt } = await issueSession(row.id)
      reply.setCookie(config.sessionCookie.name, token, {
        ...config.sessionCookie,
        expires: expiresAt,
      })

      const user = await loadUser(row.id)
      return { user }
    },
  )

  // ---------- POST /auth/signout ----------
  app.post('/auth/signout', async (req, reply) => {
    const token = req.cookies?.[config.sessionCookie.name]
    if (token) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [
        hashToken(token),
      ])
    }
    reply.clearCookie(config.sessionCookie.name, {
      path: config.sessionCookie.path,
      sameSite: config.sessionCookie.sameSite,
      secure: config.sessionCookie.secure,
      httpOnly: config.sessionCookie.httpOnly,
    })
    return { ok: true }
  })

  // ---------- GET /auth/me ----------
  app.get(
    '/auth/me',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const user = await loadUser(req.userId!)
      if (!user) {
        reply.clearCookie(config.sessionCookie.name, {
          path: config.sessionCookie.path,
          sameSite: config.sessionCookie.sameSite,
          secure: config.sessionCookie.secure,
          httpOnly: config.sessionCookie.httpOnly,
        })
        return reply.code(401).send({ error: 'Session user missing' })
      }
      return { user }
    },
  )
}