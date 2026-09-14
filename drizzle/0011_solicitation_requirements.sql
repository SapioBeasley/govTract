CREATE TABLE "solicitation_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "solicitation_understanding_id" uuid NOT NULL,
  "requirement_key" text NOT NULL,
  "requirement_type" text NOT NULL,
  "requirement_level" text NOT NULL,
  "text" text NOT NULL,
  "source_section" text NOT NULL,
  "source_finding_key" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solicitation_requirements_type_check"
    CHECK ("requirement_type" IN (
      'scope', 'deliverable', 'work', 'location', 'deadline', 'schedule', 'quantity',
      'qualification', 'license', 'certification', 'insurance', 'bonding', 'insurance_bonding',
      'mandatory_event', 'pricing', 'form', 'submission_instruction', 'evaluation', 'disqualifier'
    )),
  CONSTRAINT "solicitation_requirements_level_check"
    CHECK ("requirement_level" IN ('required', 'optional', 'unknown')),
  CONSTRAINT "solicitation_requirements_source_section_check"
    CHECK ("source_section" IN (
      'scope', 'deliverables', 'workBreakdown', 'location', 'schedule', 'quantities',
      'qualifications', 'insuranceBonding', 'mandatoryEvents', 'pricingInstructions',
      'submissionComponents', 'evaluationCriteria', 'disqualifiers'
    ))
);
--> statement-breakpoint
ALTER TABLE "solicitation_requirements" ADD CONSTRAINT "solicitation_requirements_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_requirements" ADD CONSTRAINT "solicitation_requirements_understanding_fk" FOREIGN KEY ("solicitation_understanding_id") REFERENCES "public"."solicitation_understandings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "solicitation_requirements_understanding_key_uidx" ON "solicitation_requirements" USING btree ("solicitation_understanding_id", "requirement_key");
--> statement-breakpoint
CREATE INDEX "solicitation_requirements_opportunity_idx" ON "solicitation_requirements" USING btree ("opportunity_id");
--> statement-breakpoint
CREATE INDEX "solicitation_requirements_type_idx" ON "solicitation_requirements" USING btree ("requirement_type");
--> statement-breakpoint
CREATE INDEX "solicitation_requirements_source_finding_idx" ON "solicitation_requirements" USING btree ("solicitation_understanding_id", "source_finding_key");
