CREATE TABLE "document_extraction_closeouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "opportunity_document_id" uuid NOT NULL,
  "opportunity_document_version_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reason" text DEFAULT 'opportunity_inactive' NOT NULL,
  "failure_code" text,
  "trigger_source" text NOT NULL,
  "trigger_agency" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_extraction_closeouts" ADD CONSTRAINT "doc_closeouts_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_extraction_closeouts" ADD CONSTRAINT "doc_closeouts_document_fk" FOREIGN KEY ("opportunity_document_id") REFERENCES "public"."opportunity_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_extraction_closeouts" ADD CONSTRAINT "doc_closeouts_version_fk" FOREIGN KEY ("opportunity_document_version_id") REFERENCES "public"."opportunity_document_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_extraction_closeouts_version_uidx" ON "document_extraction_closeouts" USING btree ("opportunity_document_version_id");
--> statement-breakpoint
CREATE INDEX "document_extraction_closeouts_status_idx" ON "document_extraction_closeouts" USING btree ("status", "requested_at");
--> statement-breakpoint
CREATE INDEX "document_extraction_closeouts_opportunity_idx" ON "document_extraction_closeouts" USING btree ("opportunity_id");
