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

import { opportunityDocumentVersions } from "./schema";

const jsonObject = sql`'{}'::jsonb`;

export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checksumSha256: text("checksum_sha256").notNull(),
    extractorName: text("extractor_name").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    status: text("status").notNull().default("pending"),
    sourceMimeType: text("source_mime_type"),
    sourceByteCount: bigint("source_byte_count", { mode: "number" }),
    extractedCharCount: bigint("extracted_char_count", { mode: "number" }).notNull().default(0),
    extractedByteCount: bigint("extracted_byte_count", { mode: "number" }).notNull().default(0),
    segmentCount: integer("segment_count").notNull().default(0),
    truncated: boolean("truncated").notNull().default(false),
    failureCode: text("failure_code"),
    retentionClass: text("retention_class").notNull().default("regenerable"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_extractions_checksum_extractor_uidx").on(
      table.checksumSha256,
      table.extractorName,
      table.extractorVersion,
    ),
    index("document_extractions_status_idx").on(table.status, table.updatedAt),
    index("document_extractions_checksum_idx").on(table.checksumSha256),
  ],
);

export const documentExtractionSegments = pgTable(
  "document_extraction_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentExtractionId: uuid("document_extraction_id")
      .notNull()
      .references(() => documentExtractions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    segmentType: text("segment_type").notNull(),
    locator: jsonb("locator").$type<Record<string, unknown>>().notNull().default(jsonObject),
    content: text("content").notNull(),
    contentHashSha256: text("content_hash_sha256").notNull(),
    charCount: bigint("char_count", { mode: "number" }).notNull(),
    byteCount: bigint("byte_count", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_extraction_segments_extraction_ordinal_uidx").on(
      table.documentExtractionId,
      table.ordinal,
    ),
    index("document_extraction_segments_extraction_idx").on(
      table.documentExtractionId,
      table.ordinal,
    ),
  ],
);

export const opportunityDocumentVersionExtractions = pgTable(
  "opportunity_document_version_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityDocumentVersionId: uuid("opportunity_document_version_id")
      .notNull()
      .references(() => opportunityDocumentVersions.id, { onDelete: "cascade" }),
    documentExtractionId: uuid("document_extraction_id")
      .notNull()
      .references(() => documentExtractions.id, { onDelete: "cascade" }),
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_document_version_extractions_link_uidx").on(
      table.opportunityDocumentVersionId,
      table.documentExtractionId,
    ),
    index("opportunity_document_version_extractions_version_idx").on(
      table.opportunityDocumentVersionId,
    ),
    index("opportunity_document_version_extractions_extraction_idx").on(
      table.documentExtractionId,
    ),
  ],
);
