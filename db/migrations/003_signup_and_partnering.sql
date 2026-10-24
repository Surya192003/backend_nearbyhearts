BEGIN;

CREATE TABLE IF NOT EXISTS couple_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code         TEXT UNIQUE NOT NULL,
  used_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS couple_invites_code_idx
  ON couple_invites (code);

CREATE INDEX IF NOT EXISTS couple_invites_creator_idx
  ON couple_invites (creator_id);

COMMIT;