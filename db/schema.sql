-- NearbyHearts — schema v1
-- Run: psql -d nearbyhearts -f db/schema.sql

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, crypt
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  avatar_url     TEXT,
  city           TEXT,
  timezone       TEXT NOT NULL DEFAULT 'UTC',          -- new
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- new
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- couples  (symmetric: two users, one row)
-- ============================================================
CREATE TABLE couples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  together_since  DATE,
  next_visit_at   TIMESTAMPTZ,
  distance_km     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a_id <> user_b_id),
  CHECK (user_a_id < user_b_id)                -- canonical order, no duplicate pairs
);

CREATE TABLE couple_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code         TEXT UNIQUE NOT NULL,
  used_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX couple_invites_code_idx ON couple_invites (code);
CREATE INDEX couple_invites_creator_idx ON couple_invites (creator_id);

CREATE UNIQUE INDEX couples_pair_unique ON couples (user_a_id, user_b_id);
CREATE INDEX couples_user_a_idx ON couples (user_a_id);
CREATE INDEX couples_user_b_idx ON couples (user_b_id);

-- Lookup helper: given a user, find their couple
CREATE OR REPLACE VIEW user_couples AS
  SELECT user_a_id AS user_id, id AS couple_id, user_b_id AS partner_id
    FROM couples
  UNION ALL
  SELECT user_b_id AS user_id, id AS couple_id, user_a_id AS partner_id
    FROM couples;

-- ============================================================
-- sessions  (opaque auth tokens, hashed at rest)
-- ============================================================
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,            -- sha256(token) from app
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ============================================================
-- feed_items
-- ============================================================
CREATE TYPE feed_kind AS ENUM ('note', 'photo', 'milestone', 'mood');


CREATE TABLE feed_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         feed_kind NOT NULL,
  text         TEXT NOT NULL,
  image_url    TEXT,
  mood         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days')
);

CREATE INDEX feed_items_couple_created_idx ON feed_items (couple_id, created_at DESC);
CREATE INDEX feed_items_author_idx ON feed_items (author_id);
CREATE INDEX feed_items_expires_idx ON feed_items (expires_at);

-- ============================================================
-- feed_reactions  (one per user per item; toggle = INSERT / DELETE)
-- ============================================================
CREATE TABLE feed_reactions (
  feed_item_id  UUID NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_item_id, user_id)
);

CREATE INDEX feed_reactions_user_idx ON feed_reactions (user_id);

-- ============================================================
-- messages  (chat)
-- ============================================================
CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  read_at      TIMESTAMPTZ,
  is_incognito BOOLEAN NOT NULL DEFAULT false,               -- new
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days'),  -- new
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_couple_created_idx ON messages (couple_id, created_at DESC);
CREATE INDEX messages_unread_idx ON messages (couple_id, sender_id) WHERE read_at IS NULL;
CREATE INDEX messages_expires_idx ON messages (expires_at);  -- new

-- ============================================================
-- gifts  (catalog — seeded, not user-editable in v1)
-- ============================================================
CREATE TABLE gifts (
  id           TEXT PRIMARY KEY,               -- e.g. 'g_coffee'
  name         TEXT NOT NULL,
  emoji        TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  blurb        TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================
-- sent_gifts
-- ============================================================
CREATE TABLE sent_gifts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  gift_id      TEXT NOT NULL REFERENCES gifts(id),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days'),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX sent_gifts_couple_created_idx ON sent_gifts (couple_id, created_at DESC);
CREATE INDEX sent_gifts_expires_idx ON sent_gifts (expires_at);

-- ============================================================
-- donations
-- ============================================================
CREATE TYPE donation_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TABLE donations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL for guest
  couple_id              UUID REFERENCES couples(id) ON DELETE SET NULL,
  code                   TEXT NOT NULL DEFAULT 'general',               -- e.g. 'photobooth'
  amount_cents           INTEGER NOT NULL CHECK (amount_cents > 0),
  donor_name             TEXT NOT NULL,
  message                TEXT NOT NULL DEFAULT '',
  provider               TEXT,                                          -- 'stripe', 'paypal'
  provider_ref           TEXT UNIQUE,                                   -- PaymentIntent id
  status                 donation_status NOT NULL DEFAULT 'pending',
  bonus_photos_granted   INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX donations_user_created_idx ON donations (user_id, created_at DESC);
CREATE INDEX donations_provider_ref_idx ON donations (provider_ref);

CREATE TRIGGER donations_updated_at
  BEFORE UPDATE ON donations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- photo_quota  (per-user, per-day — server-enforced)
-- ============================================================
-- The client still stores photos in IndexedDB. This table only tracks the
-- ALLOWANCE so users can't bypass the limit by clearing localStorage.
--
-- NOTE: this changes behavior vs. the current app. Current app resets quota
-- per-device; this table makes it per-user across devices.

CREATE TABLE photo_quota (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date       DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  free_used        INTEGER NOT NULL DEFAULT 0 CHECK (free_used >= 0),
  bonus_pool       INTEGER NOT NULL DEFAULT 0 CHECK (bonus_pool >= 0),
  PRIMARY KEY (user_id, quota_date)
);

-- ============================================================
-- OPTIONAL: encrypted photo sync  (DO NOT ENABLE without E2E)
-- ============================================================
-- If you ever want photos to sync between devices, they must be encrypted
-- client-side. The server stores ciphertext it cannot read.
--
-- CREATE TABLE encrypted_photos (
--   id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   couple_id      UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
--   owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--   session_id     UUID NOT NULL,
--   ciphertext     BYTEA NOT NULL,             -- client-encrypted blob
--   iv             BYTEA NOT NULL,
--   created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- CREATE INDEX encrypted_photos_couple_idx ON encrypted_photos (couple_id, created_at DESC);
--
-- Enabling this WITHOUT client-side E2E encryption violates the project's
-- stated "photos are private to the couple" requirement.

-- ============================================================
-- Views matching the app's domain types
-- ============================================================
CREATE VIEW feed_items_with_reactions AS
SELECT
  fi.id,
  fi.couple_id,
  fi.author_id,
  u.first_name || ' ' || u.last_name AS author_name,
  u.avatar_url                        AS author_avatar_url,
  fi.kind,
  fi.text,
  fi.image_url,
  fi.mood,
  fi.created_at,
  COALESCE(rc.cnt, 0)::int            AS reaction_count
FROM feed_items fi
JOIN users u ON u.id = fi.author_id
LEFT JOIN (
  SELECT feed_item_id, COUNT(*)::int AS cnt
  FROM feed_reactions
  GROUP BY feed_item_id
) rc ON rc.feed_item_id = fi.id;