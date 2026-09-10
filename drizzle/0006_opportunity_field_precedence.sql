ALTER TABLE opportunity_source_records
  ADD COLUMN source_authority text NOT NULL DEFAULT 'unknown',
  ADD COLUMN normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE opportunities
  ADD COLUMN field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE opportunity_source_records AS osr
SET source_authority = CASE lower(sr.source)
  WHEN 'beacon' THEN 'authoritative'
  WHEN 'sam.gov' THEN 'authoritative'
  WHEN 'sam' THEN 'authoritative'
  WHEN 'bidnet' THEN 'aggregator'
  WHEN 'bidnet-direct' THEN 'aggregator'
  ELSE 'unknown'
END
FROM source_records AS sr
WHERE sr.id = osr.source_record_id;

UPDATE opportunity_source_records AS osr
SET normalized_payload = jsonb_build_object(
  'solicitationNumber', o.solicitation_number,
  'title', o.title,
  'description', o.description,
  'status', o.status,
  'sourceStatus', o.source_status,
  'opportunityType', o.opportunity_type,
  'agencyName', o.agency_name,
  'agencySlug', o.agency_slug,
  'departments', o.departments,
  'categories', o.categories,
  'publishedAt', o.published_at,
  'issueAt', o.issue_at,
  'dueAt', o.due_at,
  'canonicalUrl', o.canonical_url,
  'location', o.location
)
FROM opportunities AS o
WHERE o.id = osr.opportunity_id
  AND osr.is_primary = true
  AND osr.normalized_payload = '{}'::jsonb;
