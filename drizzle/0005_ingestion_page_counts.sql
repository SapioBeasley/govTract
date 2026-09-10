ALTER TABLE ingestion_run_pages
  ADD COLUMN inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN updated_count integer NOT NULL DEFAULT 0,
  ADD COLUMN unchanged_count integer NOT NULL DEFAULT 0;
