-- Append-only reviewer determinations. Never overwrite the AI finding, original
-- source evidence, historical compliance rows, or bidder response proof.
CREATE TABLE bid_requirement_source_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_workspace_id uuid NOT NULL REFERENCES bid_workspaces(id) ON DELETE CASCADE,
  bid_requirement_id uuid NOT NULL REFERENCES bid_requirements(id) ON DELETE CASCADE,
  understanding_id uuid NOT NULL,
  source_requirement_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  source_fingerprint text NOT NULL,
  level text NOT NULL CHECK (level IN ('required', 'optional')),
  document_version_id uuid NOT NULL,
  document_checksum text NOT NULL,
  snapshot_document_id uuid NOT NULL,
  segment_id uuid NOT NULL,
  locator jsonb NOT NULL,
  excerpt text NOT NULL,
  reviewer_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_source_reviews_requirement_created_idx
 ON bid_requirement_source_reviews (bid_requirement_id, created_at);
CREATE INDEX bid_source_reviews_workspace_idx
 ON bid_requirement_source_reviews (bid_workspace_id);

CREATE UNIQUE INDEX bid_source_reviews_determination_uidx
 ON bid_requirement_source_reviews (bid_requirement_id, understanding_id, snapshot_id,
 source_fingerprint, level, document_version_id, excerpt);
