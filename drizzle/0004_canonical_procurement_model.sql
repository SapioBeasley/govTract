-- Canonical procurement entities for multi-source opportunities, historical awards,
-- company matching, saved pursuits, and bid workspaces.
-- Existing source-oriented columns on opportunities remain as compatibility mirrors
-- for the current Beacon ingestion/UI. Multi-source provenance is authoritative in
-- opportunity_source_records and can support #8 identity resolution without losing
-- any contributing raw source record.

CREATE TABLE agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  agency_type text,
  jurisdiction text,
  website_url text,
  uei text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agencies_name_idx ON agencies (canonical_name);
CREATE INDEX agencies_type_jurisdiction_idx ON agencies (agency_type, jurisdiction);
CREATE INDEX agencies_uei_idx ON agencies (uei);

CREATE TABLE opportunity_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  link_method text NOT NULL DEFAULT 'direct',
  confidence integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_source_records_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX opportunity_source_records_source_record_uidx
  ON opportunity_source_records (source_record_id);
CREATE UNIQUE INDEX opportunity_source_records_opportunity_source_uidx
  ON opportunity_source_records (opportunity_id, source_record_id);
CREATE INDEX opportunity_source_records_opportunity_primary_idx
  ON opportunity_source_records (opportunity_id, is_primary);
CREATE INDEX opportunity_source_records_agency_idx
  ON opportunity_source_records (agency_id);

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  legal_name text,
  uei text,
  cage_code text,
  duns text,
  website_url text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vendors_uei_uidx ON vendors (uei);
CREATE INDEX vendors_name_idx ON vendors (canonical_name);
CREATE INDEX vendors_cage_code_idx ON vendors (cage_code);

CREATE TABLE awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  award_number text,
  piid text,
  parent_award_number text,
  title text,
  description text,
  award_type text,
  amount numeric(20, 2),
  currency text NOT NULL DEFAULT 'USD',
  awarded_at timestamptz,
  period_start_at timestamptz,
  period_end_at timestamptz,
  place_of_performance jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX awards_agency_awarded_idx ON awards (agency_id, awarded_at);
CREATE INDEX awards_vendor_awarded_idx ON awards (vendor_id, awarded_at);
CREATE INDEX awards_award_number_idx ON awards (award_number);
CREATE INDEX awards_piid_idx ON awards (piid);

CREATE TABLE award_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id uuid NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  link_method text NOT NULL DEFAULT 'direct',
  confidence integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT award_source_records_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX award_source_records_source_record_uidx
  ON award_source_records (source_record_id);
CREATE UNIQUE INDEX award_source_records_award_source_uidx
  ON award_source_records (award_id, source_record_id);
CREATE INDEX award_source_records_award_idx ON award_source_records (award_id);

CREATE TABLE opportunity_award_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  award_id uuid NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  method text NOT NULL,
  confidence integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_derived boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_award_relationships_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX opportunity_award_relationships_uidx
  ON opportunity_award_relationships (opportunity_id, award_id, relationship_type);
CREATE INDEX opportunity_award_relationships_opportunity_idx
  ON opportunity_award_relationships (opportunity_id);
CREATE INDEX opportunity_award_relationships_award_idx
  ON opportunity_award_relationships (award_id);

CREATE TABLE intelligence_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  award_id uuid REFERENCES awards(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  finding_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer,
  derivation_method text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_findings_subject_check
    CHECK (opportunity_id IS NOT NULL OR award_id IS NOT NULL OR vendor_id IS NOT NULL),
  CONSTRAINT intelligence_findings_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
);

CREATE INDEX intelligence_findings_opportunity_type_idx
  ON intelligence_findings (opportunity_id, finding_type);
CREATE INDEX intelligence_findings_award_type_idx
  ON intelligence_findings (award_id, finding_type);
CREATE INDEX intelligence_findings_vendor_type_idx
  ON intelligence_findings (vendor_id, finding_type);

CREATE TABLE company_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  uei text,
  cage_code text,
  website_url text,
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  naics_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  psc_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  service_areas jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX company_profiles_default_idx ON company_profiles (is_default);
CREATE INDEX company_profiles_name_idx ON company_profiles (name);

CREATE TABLE opportunity_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  company_profile_id uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  score integer,
  status text NOT NULL DEFAULT 'unreviewed',
  reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  disqualifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  method text NOT NULL DEFAULT 'deterministic',
  input_fingerprint text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_matches_score_check CHECK (score IS NULL OR score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX opportunity_matches_profile_fingerprint_uidx
  ON opportunity_matches (opportunity_id, company_profile_id, input_fingerprint);
CREATE INDEX opportunity_matches_profile_score_idx
  ON opportunity_matches (company_profile_id, score);
CREATE INDEX opportunity_matches_opportunity_idx
  ON opportunity_matches (opportunity_id);

CREATE TABLE saved_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  company_profile_id uuid REFERENCES company_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'saved',
  notes text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX saved_opportunities_opportunity_profile_uidx
  ON saved_opportunities (opportunity_id, company_profile_id);
CREATE INDEX saved_opportunities_status_idx ON saved_opportunities (status, saved_at);

CREATE TABLE bid_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  company_profile_id uuid REFERENCES company_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bid_workspaces_opportunity_profile_uidx
  ON bid_workspaces (opportunity_id, company_profile_id);
CREATE INDEX bid_workspaces_status_idx ON bid_workspaces (status, updated_at);

CREATE TABLE bid_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_workspace_id uuid NOT NULL REFERENCES bid_workspaces(id) ON DELETE CASCADE,
  source_requirement_key text,
  requirement_type text NOT NULL,
  text text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bid_requirements_workspace_order_idx
  ON bid_requirements (bid_workspace_id, sort_order);
CREATE INDEX bid_requirements_workspace_status_idx
  ON bid_requirements (bid_workspace_id, status);

CREATE TABLE bid_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_workspace_id uuid NOT NULL REFERENCES bid_workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions text,
  content text,
  status text NOT NULL DEFAULT 'draft',
  requirement_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  word_count bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_sections_word_count_check CHECK (word_count >= 0)
);

CREATE INDEX bid_sections_workspace_order_idx
  ON bid_sections (bid_workspace_id, sort_order);
CREATE INDEX bid_sections_workspace_status_idx
  ON bid_sections (bid_workspace_id, status);

-- Seed canonical agencies and source links from the currently normalized opportunity
-- rows. This is deterministic and preserves the existing opportunity IDs used by the app.
INSERT INTO agencies (canonical_name, slug)
SELECT DISTINCT ON (agency_slug)
  COALESCE(NULLIF(agency_name, ''), agency_slug),
  agency_slug
FROM opportunities
WHERE agency_slug IS NOT NULL AND agency_slug <> ''
ORDER BY agency_slug, updated_at DESC
ON CONFLICT (slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    updated_at = now();

INSERT INTO opportunity_source_records (
  opportunity_id,
  source_record_id,
  agency_id,
  is_primary,
  link_method,
  confidence,
  evidence,
  first_seen_at,
  last_seen_at
)
SELECT
  o.id,
  o.source_record_id,
  a.id,
  true,
  'direct',
  100,
  jsonb_build_object(
    'source', o.source,
    'sourceOpportunityId', o.source_opportunity_id,
    'backfilledFrom', 'opportunities'
  ),
  o.first_seen_at,
  o.last_seen_at
FROM opportunities o
LEFT JOIN agencies a ON a.slug = o.agency_slug
ON CONFLICT (source_record_id) DO UPDATE
SET opportunity_id = EXCLUDED.opportunity_id,
    agency_id = EXCLUDED.agency_id,
    is_primary = true,
    link_method = 'direct',
    confidence = 100,
    evidence = EXCLUDED.evidence,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();
