-- Keep the pre-existing Bid Workspace status `open` readable/writable for older
-- callers while new compliance-matrix writes use `missing`. Do not weaken
-- the application API: it only accepts the five new response statuses.
-- Additive correction to the 0016 constraint; preserve historical test fixtures.
ALTER TABLE bid_requirements
  DROP CONSTRAINT IF EXISTS bid_requirements_response_status_check;

ALTER TABLE bid_requirements
  ADD CONSTRAINT bid_requirements_response_status_check
  CHECK (status IN ('open', 'missing', 'drafting', 'complete', 'needs_review', 'not_applicable')) NOT VALID;
