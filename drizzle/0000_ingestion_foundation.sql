CREATE TABLE public.ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  scope text NOT NULL,
  agency text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  reported_total integer CHECK (reported_total IS NULL OR reported_total >= 0),
  pages_fetched integer NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  records_seen integer NOT NULL DEFAULT 0 CHECK (records_seen >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  unchanged_count integer NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ingestion_runs_source_scope_started_idx
  ON public.ingestion_runs (source, scope, started_at DESC);

CREATE TABLE public.ingestion_run_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES public.ingestion_runs(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  reported_total integer CHECK (reported_total IS NULL OR reported_total >= 0),
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  raw_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingestion_run_id, page_number)
);

CREATE INDEX ingestion_run_pages_run_idx
  ON public.ingestion_run_pages (ingestion_run_id, page_number);

CREATE TABLE public.source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_record_id text NOT NULL,
  source_revision_id text,
  source_modified_at timestamptz,
  source_agency text,
  canonical_url text,
  raw_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ingestion_run_id uuid REFERENCES public.ingestion_runs(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_record_id)
);

CREATE INDEX source_records_source_agency_active_idx
  ON public.source_records (source, source_agency, is_active);
CREATE INDEX source_records_source_modified_idx
  ON public.source_records (source, source_modified_at DESC);

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL UNIQUE REFERENCES public.source_records(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_opportunity_id text NOT NULL,
  source_revision_id text,
  solicitation_number text,
  title text NOT NULL,
  description text,
  status text,
  opportunity_type text,
  agency_name text,
  agency_slug text,
  departments text[] NOT NULL DEFAULT ARRAY[]::text[],
  categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  published_at timestamptz,
  issue_at timestamptz,
  due_at timestamptz,
  canonical_url text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_opportunity_id)
);

CREATE INDEX opportunities_due_at_idx ON public.opportunities (due_at);
CREATE INDEX opportunities_agency_status_idx ON public.opportunities (agency_slug, status);
CREATE INDEX opportunities_source_active_idx ON public.opportunities (source, is_active);

CREATE TABLE public.opportunity_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  source_document_key text NOT NULL,
  source_document_id text,
  name text NOT NULL,
  url text,
  mime_type text,
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, source_document_key)
);

CREATE INDEX opportunity_documents_opportunity_idx
  ON public.opportunity_documents (opportunity_id);
