-- Source requirements can be materialized into a workspace at most once.
-- Preserve status/notes and original snapshot/version evidence on repeated requests.
CREATE UNIQUE INDEX IF NOT EXISTS bid_requirements_workspace_source_uidx
  ON bid_requirements (bid_workspace_id, source_requirement_key)
  WHERE source_requirement_key IS NOT NULL;

-- Existing scaffold rows defaulted to "open"; align with the bid response workflow.
UPDATE bid_requirements SET status = 'missing' WHERE status = 'open';
ALTER TABLE bid_requirements ALTER COLUMN status SET DEFAULT 'missing';
ALTER TABLE bid_requirements
  ADD CONSTRAINT bid_requirements_response_status_check
  CHECK (status IN ('missing', 'drafting', 'complete', 'needs_review', 'not_applicable')) NOT VALID;
