-- Evidence that a bidder has addressed a requirement is distinct from immutable buyer-source evidence.
-- Legacy completed rows are intentionally left null and require explicit re-review.
ALTER TABLE bid_requirements ADD COLUMN response_evidence jsonb;
