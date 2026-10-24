-- Adds retention + incognito support.
-- Run once: psql -d nearbyhearts -f db/migrations/002_retention_and_incognito.sql

BEGIN;

-- messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_incognito BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE messages
   SET expires_at = created_at + interval '60 days'
 WHERE expires_at IS NULL;

ALTER TABLE messages
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 days');

CREATE INDEX IF NOT EXISTS messages_expires_idx ON messages (expires_at);

-- feed_items
ALTER TABLE feed_items
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE feed_items
   SET expires_at = created_at + interval '60 days'
 WHERE expires_at IS NULL;

ALTER TABLE feed_items
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 days');

CREATE INDEX IF NOT EXISTS feed_items_expires_idx ON feed_items (expires_at);

-- sent_gifts
ALTER TABLE sent_gifts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE sent_gifts
   SET expires_at = created_at + interval '60 days'
 WHERE expires_at IS NULL;

ALTER TABLE sent_gifts
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 days');

CREATE INDEX IF NOT EXISTS sent_gifts_expires_idx ON sent_gifts (expires_at);

COMMIT;