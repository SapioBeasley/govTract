ALTER TABLE opportunities
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active';

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_lifecycle_state_check
  CHECK (lifecycle_state IN ('active', 'inactive_unknown', 'closed', 'awarded', 'cancelled'));

UPDATE opportunities AS o
SET lifecycle_state = CASE
  WHEN lower(trim(coalesce(o.source_status, ''))) IN (
    'cancelled',
    'canceled',
    'cancelled solicitation',
    'canceled solicitation',
    'withdrawn'
  ) THEN 'cancelled'
  WHEN lower(trim(coalesce(o.source_status, ''))) IN (
    'awarded',
    'award',
    'award made',
    'contract awarded'
  ) THEN 'awarded'
  WHEN lower(trim(coalesce(o.source_status, ''))) IN (
    'closed',
    'expired',
    'complete',
    'completed'
  ) THEN 'closed'
  WHEN lower(trim(coalesce(o.status, ''))) IN (
    'cancelled',
    'canceled',
    'cancelled solicitation',
    'canceled solicitation',
    'withdrawn'
  ) THEN 'cancelled'
  WHEN lower(trim(coalesce(o.status, ''))) IN (
    'awarded',
    'award',
    'award made',
    'contract awarded'
  ) THEN 'awarded'
  WHEN lower(trim(coalesce(o.status, ''))) IN (
    'closed',
    'expired',
    'complete',
    'completed'
  ) THEN 'closed'
  WHEN EXISTS (
    SELECT 1
    FROM opportunity_source_records AS osr
    JOIN source_records AS sr ON sr.id = osr.source_record_id
    WHERE osr.opportunity_id = o.id
      AND sr.is_active = true
  ) THEN 'active'
  ELSE 'inactive_unknown'
END;

UPDATE opportunities
SET is_active = (lifecycle_state = 'active');

CREATE INDEX opportunities_lifecycle_state_idx
  ON opportunities (lifecycle_state);
