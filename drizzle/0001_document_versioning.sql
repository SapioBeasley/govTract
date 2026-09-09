ALTER TABLE public.opportunity_documents
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS opportunity_documents_opportunity_active_idx
  ON public.opportunity_documents (opportunity_id, is_active);

CREATE TABLE IF NOT EXISTS public.opportunity_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_document_id uuid NOT NULL REFERENCES public.opportunity_documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  fingerprint text NOT NULL,
  source_version_id text,
  source_modified_at timestamptz,
  is_amendment boolean NOT NULL DEFAULT false,
  amendment_label text,
  checksum_sha256 text,
  retrieved_at timestamptz,
  storage_mode text NOT NULL DEFAULT 'source' CHECK (storage_mode IN ('source', 'object_store')),
  storage_uri text,
  content_persisted boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  url text,
  mime_type text,
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_document_id, version_number)
);

CREATE INDEX IF NOT EXISTS opportunity_document_versions_document_idx
  ON public.opportunity_document_versions (opportunity_document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS opportunity_document_versions_checksum_idx
  ON public.opportunity_document_versions (checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;

-- Preserve the currently normalized document metadata as an initial historical snapshot.
-- The legacy fingerprint is intentionally distinct; the next source ingest will create
-- a deterministic source fingerprint without losing this pre-versioning baseline.
INSERT INTO public.opportunity_document_versions (
  opportunity_document_id,
  version_number,
  fingerprint,
  name,
  url,
  mime_type,
  file_size_bytes,
  source_metadata,
  storage_mode,
  content_persisted
)
SELECT
  document.id,
  1,
  'legacy:' || document.id::text,
  document.name,
  document.url,
  document.mime_type,
  document.file_size_bytes,
  document.source_metadata,
  'source',
  false
FROM public.opportunity_documents AS document
WHERE NOT EXISTS (
  SELECT 1
  FROM public.opportunity_document_versions AS version
  WHERE version.opportunity_document_id = document.id
);
