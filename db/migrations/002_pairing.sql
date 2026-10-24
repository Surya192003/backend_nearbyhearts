-- NearbyHearts — pairing + couple metadata
-- Run: psql -d nearbyhearts -f db/migrations/002_pairing.sql

BEGIN;

-- ---------- pair codes ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS pair_code TEXT;

UPDATE users
   SET pair_code = upper(substr(md5(random()::text || id::text), 1, 8))
 WHERE pair_code IS NULL;

ALTER TABLE users ALTER COLUMN pair_code SET NOT NULL;
ALTER TABLE users ALTER COLUMN pair_code
  SET DEFAULT upper(substr(md5(random()::text), 1, 8));

CREATE UNIQUE INDEX IF NOT EXISTS users_pair_code_unique
  ON users (pair_code);

-- ---------- pair requests ----------
CREATE TABLE IF NOT EXISTS pair_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS pair_requests_to_user_idx
  ON pair_requests (to_user_id);

CREATE INDEX IF NOT EXISTS pair_requests_from_user_idx
  ON pair_requests (from_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS pair_requests_pair_unique
  ON pair_requests (from_user_id, to_user_id);

-- ---------- coupled users should not have pending requests ----------
-- (enforced in application layer on accept; this is a safety net)

COMMIT;