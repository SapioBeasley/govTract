-- Record user-confirmed external submissions separately from internal approval.
-- Records are bound to the exact final-review fingerprint so later package revisions
-- cannot silently inherit a Submitted state.
CREATE TABLE bid_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_workspace_id uuid NOT NULL REFERENCES bid_workspaces(id) ON DELETE CASCADE,
  review_fingerprint text NOT NULL,
  submitted_at timestamptz NOT NULL,
  confirmation_number text,
  receipt_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bid_submissions_workspace_review_uidx
  ON bid_submissions (bid_workspace_id, review_fingerprint);

CREATE INDEX bid_submissions_workspace_submitted_idx
  ON bid_submissions (bid_workspace_id, submitted_at);
