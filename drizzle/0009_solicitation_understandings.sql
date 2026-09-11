CREATE TABLE "solicitation_understandings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "input_fingerprint" text NOT NULL,
  "schema_version" text NOT NULL,
  "prompt_version" text NOT NULL,
  "model_provider" text NOT NULL,
  "model_name" text NOT NULL,
  "model_version" text,
  "generation_trigger" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "structured_output" jsonb,
  "processing_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processing_completed_at" timestamp with time zone,
  "generated_at" timestamp with time zone,
  "is_stale" boolean DEFAULT false NOT NULL,
  "stale_at" timestamp with time zone,
  "stale_reason" text,
  "failure_code" text,
  "input_token_count" bigint,
  "output_token_count" bigint,
  "input_char_count" bigint,
  "output_char_count" bigint,
  "estimated_cost_microusd" bigint,
  "actual_cost_microusd" bigint,
  "usage_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solicitation_understandings_generation_trigger_check"
    CHECK ("generation_trigger" IN ('automatic_initial', 'manual')),
  CONSTRAINT "solicitation_understandings_status_check"
    CHECK ("status" IN ('pending', 'completed', 'failed')),
  CONSTRAINT "solicitation_understandings_completed_output_check"
    CHECK ("status" <> 'completed' OR "structured_output" IS NOT NULL),
  CONSTRAINT "solicitation_understandings_stale_timestamp_check"
    CHECK (NOT "is_stale" OR "stale_at" IS NOT NULL),
  CONSTRAINT "solicitation_understandings_usage_nonnegative_check"
    CHECK (
      ("input_token_count" IS NULL OR "input_token_count" >= 0) AND
      ("output_token_count" IS NULL OR "output_token_count" >= 0) AND
      ("input_char_count" IS NULL OR "input_char_count" >= 0) AND
      ("output_char_count" IS NULL OR "output_char_count" >= 0) AND
      ("estimated_cost_microusd" IS NULL OR "estimated_cost_microusd" >= 0) AND
      ("actual_cost_microusd" IS NULL OR "actual_cost_microusd" >= 0)
    )
);
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD CONSTRAINT "solicitation_understandings_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "solicitation_understandings_one_automatic_uidx" ON "solicitation_understandings" USING btree ("opportunity_id") WHERE "generation_trigger" = 'automatic_initial';
--> statement-breakpoint
CREATE INDEX "solicitation_understandings_opportunity_created_idx" ON "solicitation_understandings" USING btree ("opportunity_id", "created_at");
--> statement-breakpoint
CREATE INDEX "solicitation_understandings_opportunity_stale_idx" ON "solicitation_understandings" USING btree ("opportunity_id", "is_stale");
--> statement-breakpoint
CREATE TABLE "solicitation_understanding_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "solicitation_understanding_id" uuid NOT NULL,
  "opportunity_document_version_id" uuid NOT NULL,
  "document_extraction_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_inputs" ADD CONSTRAINT "solicitation_understanding_inputs_understanding_fk" FOREIGN KEY ("solicitation_understanding_id") REFERENCES "public"."solicitation_understandings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_inputs" ADD CONSTRAINT "solicitation_understanding_inputs_version_fk" FOREIGN KEY ("opportunity_document_version_id") REFERENCES "public"."opportunity_document_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_inputs" ADD CONSTRAINT "solicitation_understanding_inputs_extraction_fk" FOREIGN KEY ("document_extraction_id") REFERENCES "public"."document_extractions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "solicitation_understanding_inputs_version_uidx" ON "solicitation_understanding_inputs" USING btree ("solicitation_understanding_id", "opportunity_document_version_id");
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_inputs_version_idx" ON "solicitation_understanding_inputs" USING btree ("opportunity_document_version_id");
--> statement-breakpoint
CREATE TABLE "solicitation_understanding_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "solicitation_understanding_id" uuid NOT NULL,
  "finding_key" text NOT NULL,
  "opportunity_document_version_id" uuid NOT NULL,
  "document_extraction_segment_id" uuid,
  "locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "excerpt" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_evidence" ADD CONSTRAINT "solicitation_understanding_evidence_understanding_fk" FOREIGN KEY ("solicitation_understanding_id") REFERENCES "public"."solicitation_understandings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_evidence" ADD CONSTRAINT "solicitation_understanding_evidence_version_fk" FOREIGN KEY ("opportunity_document_version_id") REFERENCES "public"."opportunity_document_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_evidence" ADD CONSTRAINT "solicitation_understanding_evidence_segment_fk" FOREIGN KEY ("document_extraction_segment_id") REFERENCES "public"."document_extraction_segments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_evidence_finding_idx" ON "solicitation_understanding_evidence" USING btree ("solicitation_understanding_id", "finding_key");
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_evidence_version_idx" ON "solicitation_understanding_evidence" USING btree ("opportunity_document_version_id");
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_evidence_segment_idx" ON "solicitation_understanding_evidence" USING btree ("document_extraction_segment_id");
