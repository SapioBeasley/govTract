-- Each model invocation belongs to one explicit bid-section draft request.
-- User edits are stored in bid_sections; completed generation artifacts remain historical.
CREATE TABLE bid_draft_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_workspace_id uuid NOT NULL REFERENCES bid_workspaces(id) ON DELETE CASCADE,
  bid_section_id uuid NOT NULL REFERENCES bid_sections(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  generation_trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  applied boolean NOT NULL DEFAULT false,
  source_snapshot_id uuid NOT NULL,
  document_set_fingerprint text NOT NULL,
  understanding_id uuid NOT NULL,
  input_fingerprint text NOT NULL,
  document_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  model_version text,
  pricing_profile_version text NOT NULL,
  prompt_version text NOT NULL,
  generated_content text,
  missing_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_microusd bigint,
  actual_cost_microusd bigint,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT bid_draft_generations_trigger_check CHECK (generation_trigger = 'manual'),
  CONSTRAINT bid_draft_generations_status_check CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT bid_draft_generations_cost_check CHECK (
    (estimated_cost_microusd IS NULL OR estimated_cost_microusd >= 0)
    AND (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0)
  )
);

CREATE UNIQUE INDEX bid_draft_generations_section_request_uidx
  ON bid_draft_generations (bid_section_id, request_id);
CREATE INDEX bid_draft_generations_workspace_created_idx
  ON bid_draft_generations (bid_workspace_id, created_at);
CREATE INDEX bid_draft_generations_section_created_idx
  ON bid_draft_generations (bid_section_id, created_at);
