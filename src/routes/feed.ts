import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requiresAuth } from '../middleware/auth.js'
import type { ApiFeedItem } from '../types.js'

type FeedRow = {
  id: string
  author_id: string
  author_name: string
  author_avatar_url: string | null
  kind: ApiFeedItem['kind']
  text: string
  image_url: string | null
  mood: string | null
  created_at: Date
  reaction_count: number
  reacted_by_me: boolean
}

function mapItem(r: FeedRow): ApiFeedItem {
  return {
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    kind: r.kind,
    text: r.text,
    imageUrl: r.image_url,
    mood: r.mood,
    createdAt: r.created_at.toISOString(),
    reactionCount: r.reaction_count,
    reactedByMe: r.reacted_by_me,
  }
}

async function getCoupleId(userId: string): Promise<string | null> {
  const r = await pool.query<{ couple_id: string }>(
    'SELECT couple_id FROM user_couples WHERE user_id = $1',
    [userId],
  )
  return r.rows[0]?.couple_id ?? null
}

async function fetchItem(id: string, userId: string): Promise<ApiFeedItem | null> {
  const r = await pool.query<FeedRow>(
    `SELECT
        fi.id, fi.author_id,
        au.first_name || ' ' || au.last_name AS author_name,
        au.avatar_url AS author_avatar_url,
        fi.kind, fi.text, fi.image_url, fi.mood, fi.created_at,
        (SELECT COUNT(*)::int FROM feed_reactions WHERE feed_item_id = fi.id) AS reaction_count,
        EXISTS(SELECT 1 FROM feed_reactions WHERE feed_item_id = fi.id AND user_id = $2) AS reacted_by_me
      FROM feed_items fi
      JOIN users au ON au.id = fi.author_id
      WHERE fi.id = $1`,
    [id, userId],
  )
  const row = r.rows[0]
  return row ? mapItem(row) : null
}

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/feed', { preHandler: requiresAuth }, async (req, reply) => {
    const coupleId = await getCoupleId(req.userId!)
    if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
    const r = await pool.query<FeedRow>(
      `SELECT
          fi.id, fi.author_id,
          au.first_name || ' ' || au.last_name AS author_name,
          au.avatar_url AS author_avatar_url,
          fi.kind, fi.text, fi.image_url, fi.mood, fi.created_at,
          (SELECT COUNT(*)::int FROM feed_reactions WHERE feed_item_id = fi.id) AS reaction_count,
          EXISTS(SELECT 1 FROM feed_reactions WHERE feed_item_id = fi.id AND user_id = $2) AS reacted_by_me
        FROM feed_items fi
        JOIN users au ON au.id = fi.author_id
        WHERE fi.couple_id = $1
        ORDER BY fi.created_at DESC`,
      [coupleId, req.userId],
    )
    return r.rows.map(mapItem)
  })

  app.post<{ Body: { kind: ApiFeedItem['kind']; text: string; mood: string | null } }>(
    '/feed',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { kind, text, mood } = req.body ?? ({} as never)
      if (!kind || !text) {
        return reply.code(400).send({ error: 'kind and text required' })
      }
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
      const r = await pool.query<{ id: string }>(
        `INSERT INTO feed_items (couple_id, author_id, kind, text, mood)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [coupleId, req.userId, kind, text, mood],
      )
      const item = await fetchItem(r.rows[0]!.id, req.userId!)
      return item
    },
  )

  app.post<{ Params: { id: string } }>(
    '/feed/:id/react',
    { preHandler: requiresAuth },
    async (req, reply) => {
      const { id } = req.params
      const coupleId = await getCoupleId(req.userId!)
      if (!coupleId) return reply.code(400).send({ error: 'No couple found' })
      const exists = await pool.query(
        'SELECT 1 FROM feed_items WHERE id = $1 AND couple_id = $2',
        [id, coupleId],
      )
      if (!exists.rows[0]) return reply.code(404).send({ error: 'Not found' })

      const reacted = await pool.query(
        'SELECT 1 FROM feed_reactions WHERE feed_item_id = $1 AND user_id = $2',
        [id, req.userId],
      )
      if (reacted.rows[0]) {
        await pool.query(
          'DELETE FROM feed_reactions WHERE feed_item_id = $1 AND user_id = $2',
          [id, req.userId],
        )
      } else {
        await pool.query(
          'INSERT INTO feed_reactions (feed_item_id, user_id) VALUES ($1, $2)',
          [id, req.userId],
        )
      }
      const item = await fetchItem(id, req.userId!)
      return item
    },
  )
}