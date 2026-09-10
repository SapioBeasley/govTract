CREATE TABLE document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checksum_sha256 text NOT NULL,
  extractor_name text NOT NULL,
  extractor_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  source_mime_type text,
  source_byte_count bigint,
  extracted_char_count bigint NOT NULL DEFAULT 0,
  extracted_byte_count bigint NOT NULL DEFAULT 0,
  segment_count integer NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  failure_code text,
  retention_class text NOT NULL DEFAULT 'regenerable',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_extractions_checksum_check
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_extractions_status_check
    CHECK (status IN ('pending', 'extracted', 'failed', 'truncated')),
  CONSTRAINT document_extractions_retention_class_check
    CHECK (retention_class IN ('regenerable', 'retained')),
  CONSTRAINT document_extractions_source_byte_count_check
    CHECK (source_byte_count IS NULL OR source_byte_count >= 0),
  CONSTRAINT document_extractions_extracted_char_count_check
    CHECK (extracted_char_count >= 0),
  CONSTRAINT document_extractions_extracted_byte_count_check
    CHECK (extracted_byte_count >= 0),
  CONSTRAINT document_extractions_segment_count_check
    CHECK (segment_count >= 0)
);

CREATE UNIQUE INDEX document_extractions_checksum_extractor_uidx
  ON document_extractions (checksum_sha256, extractor_name, extractor_version);

CREATE INDEX document_extractions_status_idx
  ON document_extractions (status, updated_at);

CREATE INDEX document_extractions_checksum_idx
  ON document_extractions (checksum_sha256);

CREATE TABLE document_extraction_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_extraction_id uuid NOT NULL
    REFERENCES document_extractions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  segment_type text NOT NULL,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text NOT NULL,
  content_hash_sha256 text NOT NULL,
  char_count bigint NOT NULL,
  byte_count bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_extraction_segments_ordinal_check
    CHECK (ordinal >= 0),
  CONSTRAINT document_extraction_segments_type_check
    CHECK (segment_type IN ('document', 'page', 'sheet', 'section', 'table')),
  CONSTRAINT document_extraction_segments_hash_check
    CHECK (content_hash_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_extraction_segments_char_count_check
    CHECK (char_count >= 0),
  CONSTRAINT document_extraction_segments_byte_count_check
    CHECK (byte_count >= 0)
);

CREATE UNIQUE INDEX document_extraction_segments_extraction_ordinal_uidx
  ON document_extraction_segments (document_extraction_id, ordinal);

CREATE INDEX document_extraction_segments_extraction_idx
  ON document_extraction_segments (document_extraction_id, ordinal);

CREATE TABLE opportunity_document_version_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_document_version_id uuid NOT NULL
    REFERENCES opportunity_document_versions(id) ON DELETE CASCADE,
  document_extraction_id uuid NOT NULL
    REFERENCES document_extractions(id) ON DELETE CASCADE,
  attached_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX opportunity_document_version_extractions_link_uidx
  ON opportunity_document_version_extractions (
    opportunity_document_version_id,
    document_extraction_id
  );

CREATE INDEX opportunity_document_version_extractions_version_idx
  ON opportunity_document_version_extractions (opportunity_document_version_id);

CREATE INDEX opportunity_document_version_extractions_extraction_idx
  ON opportunity_document_version_extractions (document_extraction_id);
