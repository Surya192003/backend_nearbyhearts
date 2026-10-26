import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { generateToken, hashToken, SESSION_TTL_DAYS } from '../auth.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiCouple, ApiPartner, ApiUser } from '../types.js'
import { config } from '../config.js'
import type { FastifyReply } from 'fastify'


type UserRow = {
    id: string
    email: string
    first_name: string
    last_name: string
    avatar_url: string | null
    city: string | null
    state: string | null
    country: string | null
    timezone: string
    latitude: number | null
    longitude: number | null
    pair_code: string
    couple_id: string | null
    together_since: Date | null
    partner_id: string | null
    partner_first_name: string | null
    partner_last_name: string | null
    partner_avatar_url: string | null
    partner_timezone: string | null
    partner_city: string | null
    partner_state: string | null
    partner_country: string | null
    partner_latitude: number | null
    partner_longitude: number | null
    partner_last_seen_at: Date | null
}

const COOKIE = config.sessionCookie.name  
const MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60
const token = generateToken()
const tokenHash = hashToken(token)

async function loadUser(userId: string): Promise<ApiUser | null> {
    const r = await pool.query<UserRow>(
        `SELECT
        u.id, u.email, u.first_name, u.last_name, u.avatar_url,
        u.city, u.state, u.country, u.timezone, u.latitude, u.longitude,
        u.pair_code,
        c.id AS couple_id,
        c.together_since,
        p.id           AS partner_id,
        p.first_name   AS partner_first_name,
        p.last_name    AS partner_last_name,
        p.avatar_url   AS partner_avatar_url,
        p.timezone     AS partner_timezone,
        p.city         AS partner_city,
        p.state        AS partner_state,
        p.country      AS partner_country,
        p.latitude     AS partner_latitude,
        p.longitude    AS partner_longitude,
        p.last_seen_at AS partner_last_seen_at
      FROM users u
      LEFT JOIN couples c
        ON c.user_a_id = u.id OR c.user_b_id = u.id
      LEFT JOIN users p
        ON p.id = CASE WHEN c.user_a_id = u.id THEN c.user_b_id ELSE c.user_a_id END
      WHERE u.id = $1`,
        [userId],
    )
    const row = r.rows[0]
    if (!row) return null

    const partner: ApiPartner | null = row.partner_id
        ? {
            id: row.partner_id,
            firstName: row.partner_first_name ?? '',
            lastName: row.partner_last_name ?? '',
            avatarUrl: row.partner_avatar_url,
            city: row.partner_city ?? '',
            state: row.partner_state,
            country: row.partner_country,
            timezone: row.partner_timezone ?? 'UTC',
            latitude: row.partner_latitude,
            longitude: row.partner_longitude,
            lastSeenAt: (row.partner_last_seen_at ?? new Date()).toISOString(),
        }
        : null

    const couple: ApiCouple | null = row.couple_id
        ? {
            id: row.couple_id,
            togetherSince: row.together_since?.toISOString() ?? null,
        }
        : null

    return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        avatarUrl: row.avatar_url,
        city: row.city ?? '',
        state: row.state,
        country: row.country,
        timezone: row.timezone ?? 'UTC',
        latitude: row.latitude,
        longitude: row.longitude,
        pairCode: row.pair_code,
        couple,
        partner,
    }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',   // false in dev
    sameSite: 'lax',                                 // fine because Vite proxy = same-origin
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' })
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

    app.post<{ Body: { email: string; password: string } }>(
        '/auth/signin',
        async (req, reply) => {
            const { email, password } = req.body ?? ({} as never)
            if (!email || !password) {
                return reply.code(400).send({ error: 'Email and password required' })
            }
            const result = await pool.query<{ id: string }>(
                `SELECT id FROM users WHERE email = $1 AND password_hash = crypt($2, password_hash)`,
                [email, password],
            )
            const row = result.rows[0]
            if (!row) return reply.code(401).send({ error: 'Invalid credentials' })

            await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [
                row.id,
            ])

            const { token, expiresAt } = await issueSession(row.id)
            reply.setCookie(config.sessionCookie.name, token, {
                ...config.sessionCookie,
                expires: expiresAt,
            })

            const user = await loadUser(row.id)
            return { user }
        },
    )

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

    app.get('/auth/me', { preHandler: requiresAuth }, async (req, reply) => {
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
    })
}