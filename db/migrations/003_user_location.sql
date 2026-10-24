-- NearbyHearts — address + coordinates for distance
-- Run: psql -d nearbyhearts -f db/migrations/003_user_location.sql

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMIT;