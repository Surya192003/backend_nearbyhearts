import { pool } from './db.js'

/**
 * Deletes every row past its `expires_at` from messages, feed_items,
 * and sent_gifts. Idempotent. Safe to call concurrently.
 */
export async function cleanupExpired(): Promise<{
  messages: number
  feedItems: number
  sentGifts: number
}> {
  const m = await pool.query('DELETE FROM messages WHERE expires_at < now()')
  const f = await pool.query('DELETE FROM feed_items WHERE expires_at < now()')
  const g = await pool.query('DELETE FROM sent_gifts WHERE expires_at < now()')
  return {
    messages: m.rowCount ?? 0,
    feedItems: f.rowCount ?? 0,
    sentGifts: g.rowCount ?? 0,
  }
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let timer: NodeJS.Timeout | null = null

export function startCleanupLoop(log: (msg: string) => void): void {
  const tick = async (): Promise<void> => {
    try {
      const deleted = await cleanupExpired()
      if (deleted.messages + deleted.feedItems + deleted.sentGifts > 0) {
        log(
          `[cleanup] messages=${deleted.messages} feed=${deleted.feedItems} gifts=${deleted.sentGifts}`,
        )
      }
    } catch (err) {
      log(`[cleanup] failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  void tick() // run once on boot
  timer = setInterval(() => {
    void tick()
  }, CLEANUP_INTERVAL_MS)
}

export function stopCleanupLoop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}