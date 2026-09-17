CREATE TABLE "historical_procurement_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_type" text NOT NULL,
  "agency_id" uuid,
  "vendor_id" uuid,
  "title" text,
  "description" text,
  "occurred_at" timestamp with time zone,
  "fiscal_year" integer,
  "monetary_type" text,
  "amount" numeric(20, 2),
  "currency" text DEFAULT 'USD' NOT NULL,
  "buyer_name" text,
  "buyer_unit_name" text,
  "buyer_source_id" text,
  "vendor_name" text,
  "vendor_source_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_procurement_source_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "historical_procurement_record_id" uuid NOT NULL,
  "source_record_id" uuid NOT NULL,
  "source_fact_key" text NOT NULL,
  "source_file_id" text,
  "source_file_revision" text,
  "source_published_at" timestamp with time zone,
  "normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_procurement_identifiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "historical_procurement_record_id" uuid NOT NULL,
  "source_record_id" uuid,
  "identifier_type" text NOT NULL,
  "identifier_value" text NOT NULL,
  "source_provided" boolean DEFAULT true NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_procurement_classifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "historical_procurement_record_id" uuid NOT NULL,
  "source_record_id" uuid,
  "source_classification_key" text NOT NULL,
  "scheme" text NOT NULL,
  "code" text,
  "name" text,
  "method" text NOT NULL,
  "confidence" integer,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_procurement_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_historical_procurement_record_id" uuid NOT NULL,
  "to_historical_procurement_record_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "method" text NOT NULL,
  "confidence" integer,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_procurement_opportunity_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "historical_procurement_record_id" uuid NOT NULL,
  "opportunity_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "method" text NOT NULL,
  "confidence" integer,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "historical_procurement_records"
  ADD CONSTRAINT "historical_procurement_records_agency_id_agencies_id_fk"
  FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_records"
  ADD CONSTRAINT "historical_procurement_records_vendor_id_vendors_id_fk"
  FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_source_records"
  ADD CONSTRAINT "historical_procurement_source_records_record_id_fk"
  FOREIGN KEY ("historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_source_records"
  ADD CONSTRAINT "historical_procurement_source_records_source_record_id_fk"
  FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_identifiers"
  ADD CONSTRAINT "historical_procurement_identifiers_record_id_fk"
  FOREIGN KEY ("historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_identifiers"
  ADD CONSTRAINT "historical_procurement_identifiers_source_record_id_fk"
  FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_classifications"
  ADD CONSTRAINT "historical_procurement_classifications_record_id_fk"
  FOREIGN KEY ("historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_classifications"
  ADD CONSTRAINT "historical_procurement_classifications_source_record_id_fk"
  FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_relationships"
  ADD CONSTRAINT "historical_procurement_relationships_from_record_id_fk"
  FOREIGN KEY ("from_historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_relationships"
  ADD CONSTRAINT "historical_procurement_relationships_to_record_id_fk"
  FOREIGN KEY ("to_historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_opportunity_relationships"
  ADD CONSTRAINT "historical_procurement_opportunity_relationships_record_id_fk"
  FOREIGN KEY ("historical_procurement_record_id") REFERENCES "public"."historical_procurement_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "historical_procurement_opportunity_relationships"
  ADD CONSTRAINT "hist_proc_opp_rel_opportunity_fk"
  FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "historical_procurement_records_type_date_idx" ON "historical_procurement_records" USING btree ("record_type", "occurred_at");
--> statement-breakpoint
CREATE INDEX "historical_procurement_records_agency_date_idx" ON "historical_procurement_records" USING btree ("agency_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "historical_procurement_records_vendor_date_idx" ON "historical_procurement_records" USING btree ("vendor_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "historical_procurement_records_monetary_idx" ON "historical_procurement_records" USING btree ("monetary_type", "occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_procurement_source_records_source_fact_uidx" ON "historical_procurement_source_records" USING btree ("source_record_id", "source_fact_key");
--> statement-breakpoint
CREATE INDEX "historical_procurement_source_records_record_idx" ON "historical_procurement_source_records" USING btree ("historical_procurement_record_id");
--> statement-breakpoint
CREATE INDEX "historical_procurement_source_records_file_idx" ON "historical_procurement_source_records" USING btree ("source_file_id", "source_file_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_procurement_identifiers_record_type_value_uidx" ON "historical_procurement_identifiers" USING btree ("historical_procurement_record_id", "identifier_type", "identifier_value");
--> statement-breakpoint
CREATE INDEX "historical_procurement_identifiers_lookup_idx" ON "historical_procurement_identifiers" USING btree ("identifier_type", "identifier_value");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_procurement_classifications_record_key_uidx" ON "historical_procurement_classifications" USING btree ("historical_procurement_record_id", "source_classification_key");
--> statement-breakpoint
CREATE INDEX "historical_procurement_classifications_scheme_code_idx" ON "historical_procurement_classifications" USING btree ("scheme", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_procurement_relationships_uidx" ON "historical_procurement_relationships" USING btree ("from_historical_procurement_record_id", "to_historical_procurement_record_id", "relationship_type");
--> statement-breakpoint
CREATE INDEX "historical_procurement_relationships_from_idx" ON "historical_procurement_relationships" USING btree ("from_historical_procurement_record_id");
--> statement-breakpoint
CREATE INDEX "historical_procurement_relationships_to_idx" ON "historical_procurement_relationships" USING btree ("to_historical_procurement_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "historical_procurement_opportunity_relationships_uidx" ON "historical_procurement_opportunity_relationships" USING btree ("historical_procurement_record_id", "opportunity_id", "relationship_type");
--> statement-breakpoint
CREATE INDEX "historical_procurement_opportunity_relationships_record_idx" ON "historical_procurement_opportunity_relationships" USING btree ("historical_procurement_record_id");
--> statement-breakpoint
CREATE INDEX "hist_proc_opp_rel_opportunity_idx" ON "historical_procurement_opportunity_relationships" USING btree ("opportunity_id");
