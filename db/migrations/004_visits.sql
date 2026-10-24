-- NearbyHearts — multiple visits per couple with partner-approved cancellation
-- Run: psql -d nearbyhearts -f db/migrations/004_visits.sql

BEGIN;

CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT 'Visit',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'cancel_pending', 'cancelled', 'completed')),
  cancel_requested_by UUID REFERENCES users(id),
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visits_couple_scheduled_idx
  ON visits (couple_id, scheduled_at)
  WHERE status IN ('scheduled', 'cancel_pending');

DROP TRIGGER IF EXISTS visits_updated_at ON visits;
CREATE TRIGGER visits_updated_at
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;