import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const jsonObject = sql`'{}'::jsonb`;
const emptyTextArray = sql`ARRAY[]::text[]`;

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    scope: text("scope").notNull(),
    agency: text("agency"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default(jsonObject),
    reportedTotal: integer("reported_total"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    recordsSeen: integer("records_seen").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    recordErrorCount: integer("record_error_count").notNull().default(0),
    paginationComplete: boolean("pagination_complete").notNull().default(false),
    normalizationComplete: boolean("normalization_complete").notNull().default(false),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ingestion_runs_source_scope_started_idx").on(
      table.source,
      table.scope,
      table.startedAt,
    ),
  ],
);

export const ingestionRunPages = pgTable(
  "ingestion_run_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default(jsonObject),
    reportedTotal: integer("reported_total"),
    recordCount: integer("record_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ingestion_run_pages_run_page_uidx").on(
      table.ingestionRunId,
      table.pageNumber,
    ),
    index("ingestion_run_pages_run_idx").on(table.ingestionRunId, table.pageNumber),
  ],
);

export const ingestionRecordErrors = pgTable(
  "ingestion_record_errors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ingestionRunId: uuid("ingestion_run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    sourceRecordId: text("source_record_id"),
    stage: text("stage").notNull(),
    error: text("error").notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ingestion_record_errors_run_idx").on(table.ingestionRunId, table.pageNumber),
  ],
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    sourceRevisionId: text("source_revision_id"),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    sourceAgency: text("source_agency"),
    canonicalUrl: text("canonical_url"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastIngestionRunId: uuid("last_ingestion_run_id").references(() => ingestionRuns.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_records_source_record_uidx").on(table.source, table.sourceRecordId),
    index("source_records_source_agency_active_idx").on(
      table.source,
      table.sourceAgency,
      table.isActive,
    ),
    index("source_records_source_modified_idx").on(table.source, table.sourceModifiedAt),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .unique()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceOpportunityId: text("source_opportunity_id").notNull(),
    sourceRevisionId: text("source_revision_id"),
    solicitationNumber: text("solicitation_number"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status"),
    sourceStatus: text("source_status"),
    opportunityType: text("opportunity_type"),
    agencyName: text("agency_name"),
    agencySlug: text("agency_slug"),
    departments: text("departments").array().notNull().default(emptyTextArray),
    categories: text("categories").array().notNull().default(emptyTextArray),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    issueAt: timestamp("issue_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    canonicalUrl: text("canonical_url"),
    location: jsonb("location").$type<Record<string, unknown>>().notNull().default(jsonObject),
    fieldProvenance: jsonb("field_provenance")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    isActive: boolean("is_active").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunities_source_opportunity_uidx").on(
      table.source,
      table.sourceOpportunityId,
    ),
    index("opportunities_due_at_idx").on(table.dueAt),
    index("opportunities_agency_status_idx").on(table.agencySlug, table.status),
    index("opportunities_source_active_idx").on(table.source, table.isActive),
  ],
);

export const opportunityDocuments = pgTable(
  "opportunity_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    sourceDocumentKey: text("source_document_key").notNull(),
    sourceDocumentId: text("source_document_id"),
    name: text("name").notNull(),
    url: text("url"),
    mimeType: text("mime_type"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    isActive: boolean("is_active").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_documents_opportunity_key_uidx").on(
      table.opportunityId,
      table.sourceDocumentKey,
    ),
    index("opportunity_documents_opportunity_idx").on(table.opportunityId),
    index("opportunity_documents_opportunity_active_idx").on(
      table.opportunityId,
      table.isActive,
    ),
  ],
);

export const opportunityDocumentVersions = pgTable(
  "opportunity_document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityDocumentId: uuid("opportunity_document_id")
      .notNull()
      .references(() => opportunityDocuments.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    fingerprint: text("fingerprint").notNull(),
    sourceVersionId: text("source_version_id"),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    isAmendment: boolean("is_amendment").notNull().default(false),
    amendmentLabel: text("amendment_label"),
    checksumSha256: text("checksum_sha256"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    storageMode: text("storage_mode").notNull().default("source"),
    storageUri: text("storage_uri"),
    contentPersisted: boolean("content_persisted").notNull().default(false),
    name: text("name").notNull(),
    url: text("url"),
    mimeType: text("mime_type"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_document_versions_document_version_uidx").on(
      table.opportunityDocumentId,
      table.versionNumber,
    ),
    index("opportunity_document_versions_document_idx").on(
      table.opportunityDocumentId,
      table.versionNumber,
    ),
    index("opportunity_document_versions_checksum_idx").on(table.checksumSha256),
  ],
);

export const opportunityClassifications = pgTable(
  "opportunity_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    sourceClassificationKey: text("source_classification_key").notNull(),
    scheme: text("scheme").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_classifications_opportunity_key_uidx").on(
      table.opportunityId,
      table.sourceClassificationKey,
    ),
    index("opportunity_classifications_scheme_code_idx").on(table.scheme, table.code),
  ],
);
