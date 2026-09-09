CREATE TABLE source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  account_identifier text,
  status text NOT NULL DEFAULT 'disconnected',
  session_envelope_version integer NOT NULL DEFAULT 1,
  encrypted_session text,
  session_expires_at timestamptz,
  connected_at timestamptz,
  last_validated_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_connections_status_check
    CHECK (status IN ('connected', 'needs_reauth', 'disconnected'))
);

CREATE UNIQUE INDEX source_connections_provider_uidx
  ON source_connections (provider);

CREATE INDEX source_connections_status_idx
  ON source_connections (status);
