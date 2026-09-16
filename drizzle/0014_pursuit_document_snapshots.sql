CREATE TABLE IF NOT EXISTS "source_binary_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "checksum_sha256" text NOT NULL,
  "storage_provider" text NOT NULL,
  "storage_key" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "mime_type" text,
  "etag" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "source_binary_artifacts_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "source_binary_artifacts_byte_count_check" CHECK ("byte_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_binary_artifacts_checksum_uidx" ON "source_binary_artifacts" USING btree ("checksum_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_binary_artifacts_provider_key_uidx" ON "source_binary_artifacts" USING btree ("storage_provider", "storage_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pursuit_document_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "saved_opportunity_id" uuid,
  "bid_workspace_id" uuid,
  "supersedes_snapshot_id" uuid,
  "document_set_fingerprint" text NOT NULL,
  "status" text DEFAULT 'incomplete' NOT NULL,
  "total_document_count" integer DEFAULT 0 NOT NULL,
  "stored_document_count" integer DEFAULT 0 NOT NULL,
  "blocked_document_count" integer DEFAULT 0 NOT NULL,
  "failed_document_count" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pursuit_snapshots_context_check" CHECK ("saved_opportunity_id" IS NOT NULL OR "bid_workspace_id" IS NOT NULL),
  CONSTRAINT "pursuit_snapshots_status_check" CHECK ("status" IN ('incomplete', 'complete', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "pursuit_document_snapshots" ADD CONSTRAINT "pursuit_snapshots_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_document_snapshots" ADD CONSTRAINT "pursuit_snapshots_saved_opportunity_fk" FOREIGN KEY ("saved_opportunity_id") REFERENCES "public"."saved_opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_document_snapshots" ADD CONSTRAINT "pursuit_snapshots_bid_workspace_fk" FOREIGN KEY ("bid_workspace_id") REFERENCES "public"."bid_workspaces"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_document_snapshots" ADD CONSTRAINT "pursuit_snapshots_supersedes_fk" FOREIGN KEY ("supersedes_snapshot_id") REFERENCES "public"."pursuit_document_snapshots"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pursuit_snapshots_saved_fingerprint_uidx" ON "pursuit_document_snapshots" USING btree ("saved_opportunity_id", "document_set_fingerprint") WHERE "saved_opportunity_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pursuit_snapshots_workspace_fingerprint_uidx" ON "pursuit_document_snapshots" USING btree ("bid_workspace_id", "document_set_fingerprint") WHERE "bid_workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pursuit_snapshots_opportunity_created_idx" ON "pursuit_document_snapshots" USING btree ("opportunity_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pursuit_snapshots_status_idx" ON "pursuit_document_snapshots" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pursuit_snapshot_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pursuit_snapshot_id" uuid NOT NULL,
  "opportunity_document_id" uuid NOT NULL,
  "opportunity_document_version_id" uuid NOT NULL,
  "source_binary_artifact_id" uuid,
  "source" text NOT NULL,
  "source_opportunity_id" text NOT NULL,
  "source_document_key" text NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text,
  "checksum_sha256" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "failure_code" text,
  "retrieved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pursuit_snapshot_documents_status_check" CHECK ("status" IN ('pending', 'stored', 'missing', 'blocked', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "pursuit_snapshot_documents" ADD CONSTRAINT "pursuit_snapshot_documents_snapshot_fk" FOREIGN KEY ("pursuit_snapshot_id") REFERENCES "public"."pursuit_document_snapshots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_snapshot_documents" ADD CONSTRAINT "pursuit_snapshot_documents_document_fk" FOREIGN KEY ("opportunity_document_id") REFERENCES "public"."opportunity_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_snapshot_documents" ADD CONSTRAINT "pursuit_snapshot_documents_version_fk" FOREIGN KEY ("opportunity_document_version_id") REFERENCES "public"."opportunity_document_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pursuit_snapshot_documents" ADD CONSTRAINT "pursuit_snapshot_documents_artifact_fk" FOREIGN KEY ("source_binary_artifact_id") REFERENCES "public"."source_binary_artifacts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pursuit_snapshot_documents_version_uidx" ON "pursuit_snapshot_documents" USING btree ("pursuit_snapshot_id", "opportunity_document_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pursuit_snapshot_documents_snapshot_status_idx" ON "pursuit_snapshot_documents" USING btree ("pursuit_snapshot_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pursuit_snapshot_documents_artifact_idx" ON "pursuit_snapshot_documents" USING btree ("source_binary_artifact_id");
