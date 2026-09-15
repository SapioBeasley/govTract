ALTER TABLE "opportunities"
  DROP CONSTRAINT IF EXISTS "opportunities_lifecycle_state_check";
--> statement-breakpoint
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_lifecycle_state_check"
  CHECK ("lifecycle_state" IN (
    'active',
    'inactive_unknown',
    'pending_award',
    'closed',
    'awarded',
    'cancelled'
  ));
