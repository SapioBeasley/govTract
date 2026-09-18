CREATE TABLE "opportunity_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "company_profile_id" uuid NOT NULL,
  "solicitation_understanding_id" uuid,
  "input_fingerprint" text NOT NULL,
  "rule_version" text NOT NULL,
  "assessment" text NOT NULL,
  "factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opportunity_evaluations_assessment_check"
    CHECK ("assessment" IN ('go', 'conditional', 'no_go'))
);
--> statement-breakpoint
CREATE TABLE "opportunity_evaluation_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "company_profile_id" uuid NOT NULL,
  "evaluation_id" uuid,
  "decision" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opportunity_evaluation_decisions_value_check"
    CHECK ("decision" IN ('pursue', 'do_not_pursue', 'revisit'))
);
--> statement-breakpoint
ALTER TABLE "opportunity_evaluations"
  ADD CONSTRAINT "opportunity_evaluations_opportunity_id_fk"
  FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_evaluations"
  ADD CONSTRAINT "opportunity_evaluations_company_profile_id_fk"
  FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_evaluations"
  ADD CONSTRAINT "opportunity_evaluations_understanding_id_fk"
  FOREIGN KEY ("solicitation_understanding_id") REFERENCES "public"."solicitation_understandings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_evaluation_decisions"
  ADD CONSTRAINT "opportunity_evaluation_decisions_opportunity_id_fk"
  FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_evaluation_decisions"
  ADD CONSTRAINT "opportunity_evaluation_decisions_company_profile_id_fk"
  FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunity_evaluation_decisions"
  ADD CONSTRAINT "opportunity_evaluation_decisions_evaluation_id_fk"
  FOREIGN KEY ("evaluation_id") REFERENCES "public"."opportunity_evaluations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_evaluations_input_uidx"
  ON "opportunity_evaluations" USING btree ("opportunity_id", "company_profile_id", "input_fingerprint");
--> statement-breakpoint
CREATE INDEX "opportunity_evaluations_latest_idx"
  ON "opportunity_evaluations" USING btree ("opportunity_id", "company_profile_id", "evaluated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_evaluation_decisions_opportunity_profile_uidx"
  ON "opportunity_evaluation_decisions" USING btree ("opportunity_id", "company_profile_id");
--> statement-breakpoint
CREATE INDEX "opportunity_evaluation_decisions_decision_idx"
  ON "opportunity_evaluation_decisions" USING btree ("decision", "updated_at");
