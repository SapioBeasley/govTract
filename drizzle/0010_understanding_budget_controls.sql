ALTER TABLE "solicitation_understandings" ADD COLUMN "completeness_status" text DEFAULT 'partial' NOT NULL;
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD COLUMN "incomplete_reason" text;
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD COLUMN "coverage_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD COLUMN "budget_microusd" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD COLUMN "pricing_profile_version" text;
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD CONSTRAINT "solicitation_understandings_completeness_check" CHECK ("completeness_status" IN ('complete', 'partial'));
--> statement-breakpoint
ALTER TABLE "solicitation_understandings" ADD CONSTRAINT "solicitation_understandings_budget_nonnegative_check" CHECK ("budget_microusd" >= 0);
--> statement-breakpoint
CREATE TABLE "solicitation_understanding_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "solicitation_understanding_id" uuid NOT NULL,
  "opportunity_document_version_id" uuid NOT NULL,
  "document_extraction_id" uuid,
  "chunk_key" text NOT NULL,
  "input_fingerprint" text NOT NULL,
  "ordinal" integer NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "char_count" bigint NOT NULL,
  "estimated_input_token_count" bigint,
  "output_token_count" bigint,
  "estimated_cost_microusd" bigint,
  "actual_cost_microusd" bigint,
  "pricing_profile_version" text,
  "structured_output" jsonb,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "solicitation_understanding_chunks_status_check" CHECK ("status" IN ('planned', 'processed', 'reused', 'skipped')),
  CONSTRAINT "solicitation_understanding_chunks_usage_nonnegative_check" CHECK (
    "char_count" >= 0
    AND ("estimated_input_token_count" IS NULL OR "estimated_input_token_count" >= 0)
    AND ("output_token_count" IS NULL OR "output_token_count" >= 0)
    AND ("estimated_cost_microusd" IS NULL OR "estimated_cost_microusd" >= 0)
    AND ("actual_cost_microusd" IS NULL OR "actual_cost_microusd" >= 0)
  )
);
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_chunks" ADD CONSTRAINT "solicitation_understanding_chunks_understanding_fk" FOREIGN KEY ("solicitation_understanding_id") REFERENCES "public"."solicitation_understandings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_chunks" ADD CONSTRAINT "solicitation_understanding_chunks_version_fk" FOREIGN KEY ("opportunity_document_version_id") REFERENCES "public"."opportunity_document_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "solicitation_understanding_chunks" ADD CONSTRAINT "solicitation_understanding_chunks_extraction_fk" FOREIGN KEY ("document_extraction_id") REFERENCES "public"."document_extractions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "solicitation_understanding_chunks_key_uidx" ON "solicitation_understanding_chunks" USING btree ("solicitation_understanding_id", "chunk_key");
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_chunks_fingerprint_idx" ON "solicitation_understanding_chunks" USING btree ("input_fingerprint");
--> statement-breakpoint
CREATE INDEX "solicitation_understanding_chunks_version_idx" ON "solicitation_understanding_chunks" USING btree ("opportunity_document_version_id");
