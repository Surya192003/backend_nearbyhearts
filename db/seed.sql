-- NearbyHearts — seed v1
-- Run: psql -d nearbyhearts -f db/seed.sql
-- Safe to re-run: deletes all users/couples cascade first.

BEGIN;

TRUNCATE users, couples, feed_items, feed_reactions, messages, sent_gifts, donations, photo_quota
  RESTART IDENTITY CASCADE;

-- ---------- gifts catalog ----------
INSERT INTO gifts (id, name, emoji, price_cents, blurb) VALUES
  ('g_coffee',    'Coffee on me',    '☕',  450,  'A warm cup, sent across the distance.'),
  ('g_flowers',   'Flowers',         '💐', 2500,  'Delivered to their door with a handwritten note.'),
  ('g_chocolate', 'Chocolate box',   '🍫', 1800,  'Sixteen pieces, none of them shared.'),
  ('g_playlist',  'Custom playlist', '🎧',    0,  'Ten songs that sound like us.'),
  ('g_star',      'Name a star',     '⭐', 4900,  'A tiny light with your names on it.'),
  ('g_plant',     'Potted plant',    '🪴', 3200,  'Something to keep alive together.')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      emoji = EXCLUDED.emoji,
      price_cents = EXCLUDED.price_cents,
      blurb = EXCLUDED.blurb;

-- ---------- users ----------
-- Password for both: "secret123" (bcrypt cost 10). Change in prod.
WITH inserted AS (
  INSERT INTO users (email, password_hash, first_name, last_name, city)
  VALUES
    ('alex@nearbyhearts.app',
      crypt('secret123', gen_salt('bf', 10)),
      'Alex', 'Rivera', 'Dublin'),
    ('sam@nearbyhearts.app',
      crypt('secret123', gen_salt('bf', 10)),
      'Sam',  'Okafor', 'Lisbon')
  RETURNING id, email
)
SELECT 1;  -- dummy select so the CTE runs

-- ---------- couple ----------
INSERT INTO couples (user_a_id, user_b_id, together_since, next_visit_at, distance_km)
SELECT
  LEAST(a.id, b.id),
  GREATEST(a.id, b.id),
  '2024-07-14',
  now() + interval '18 days 47 minutes',
  1810
FROM users a, users b
WHERE a.email = 'alex@nearbyhearts.app'
  AND b.email = 'sam@nearbyhearts.app';

-- ---------- feed ----------
INSERT INTO feed_items (couple_id, author_id, kind, text, image_url, mood, created_at)
SELECT c.id, u.id, x.kind::feed_kind, x.text, x.image_url, x.mood, now() - x.delta
FROM (
  VALUES
    ('sam@nearbyhearts.app',  'mood',      'Missing you extra today 💭', NULL, '🥺', interval '14 minutes'),
    ('sam@nearbyhearts.app',  'photo',     'Coffee by the river — wish you were here.',
        'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=900&q=80', NULL, interval '190 minutes'),
    ('alex@nearbyhearts.app', 'milestone', '6 months since our first video call 🎉', NULL, NULL, interval '1 day'),
    ('sam@nearbyhearts.app',  'note',      'Left you a voice note before bed. Listen when you wake up.', NULL, NULL, interval '2 days')
) AS x(email, kind, text, image_url, mood, delta)
JOIN users u ON u.email = x.email
JOIN couples c ON c.user_a_id = u.id OR c.user_b_id = u.id;

-- ---------- reactions ----------
INSERT INTO feed_reactions (feed_item_id, user_id)
SELECT fi.id, u.id
FROM feed_items fi
JOIN users u ON u.email = 'alex@nearbyhearts.app'
WHERE fi.text LIKE 'Coffee by the river%';

-- ---------- messages ----------
INSERT INTO messages (couple_id, sender_id, text, created_at, read_at)
SELECT c.id, u.id, x.text, now() - x.delta,
       CASE WHEN x.is_read THEN now() - x.delta + interval '1 minute' ELSE NULL END
FROM (
  VALUES
    ('sam@nearbyhearts.app',  'Morning ☀️ how did you sleep?',                              interval '210 minutes', true),
    ('alex@nearbyhearts.app', 'Barely — stayed up watching that series you told me about.', interval '205 minutes', true),
    ('sam@nearbyhearts.app',  'I KNEW you would 😂',                                        interval '203 minutes', true),
    ('alex@nearbyhearts.app', 'Free for a call after 7?',                                    interval '20 minutes',  true),
    ('sam@nearbyhearts.app',  'Yes! I will finish work by then 💕',                          interval '6 minutes',   false)
) AS x(email, text, delta, is_read)
JOIN users u ON u.email = x.email
JOIN couples c ON c.user_a_id = u.id OR c.user_b_id = u.id;

-- ---------- sent gifts ----------
INSERT INTO sent_gifts (couple_id, gift_id, from_user_id, to_user_id, note, created_at)
SELECT c.id, x.gift_id, f.id, t.id, x.note, now() - x.delta
FROM (
  VALUES
    ('g_playlist', 'alex@nearbyhearts.app', 'sam@nearbyhearts.app',
      'Track 4 is the one from the airport.', interval '2 days'),
    ('g_coffee',   'sam@nearbyhearts.app',  'alex@nearbyhearts.app',
      'Because you were up late again.', interval '5 hours')
) AS x(gift_id, from_email, to_email, note, delta)
JOIN users f ON f.email = x.from_email
JOIN users t ON t.email = x.to_email
JOIN couples c ON (c.user_a_id = f.id AND c.user_b_id = t.id)
              OR (c.user_a_id = t.id AND c.user_b_id = f.id);

-- ---------- photo quota (start-of-day for both users) ----------
INSERT INTO photo_quota (user_id, quota_date, free_used, bonus_pool)
SELECT id, (now() AT TIME ZONE 'UTC')::date, 0, 0 FROM users;

COMMIT;