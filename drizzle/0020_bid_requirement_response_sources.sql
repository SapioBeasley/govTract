-- Persist who supplied a bidder/supplier requirement response independently of generated bid prose.
ALTER TABLE bid_requirements
  ADD COLUMN response_source_type text,
  ADD COLUMN response_source_name text;

ALTER TABLE bid_requirements
  ADD CONSTRAINT bid_requirements_response_source_type_check
  CHECK (
    response_source_type IS NULL OR
    response_source_type IN ('self', 'subcontractor', 'manufacturer', 'other')
  );
