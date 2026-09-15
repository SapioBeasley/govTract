ALTER TABLE "saved_opportunities"
  ADD COLUMN "priority" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_deadline" timestamp with time zone,
  ADD COLUMN "snapshot_status" text DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "saved_opportunities"
  ADD CONSTRAINT "saved_opportunities_status_check"
    CHECK ("status" IN ('saved', 'reviewing', 'pursuing', 'no_bid', 'submitted', 'won', 'lost')),
  ADD CONSTRAINT "saved_opportunities_priority_check"
    CHECK ("priority" BETWEEN 0 AND 5),
  ADD CONSTRAINT "saved_opportunities_snapshot_status_check"
    CHECK ("snapshot_status" IN ('not_required', 'incomplete', 'complete', 'blocked'));
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_opportunities_single_user_opportunity_uidx"
  ON "saved_opportunities" ("opportunity_id")
  WHERE "company_profile_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "saved_opportunities_internal_deadline_idx"
  ON "saved_opportunities" ("internal_deadline");