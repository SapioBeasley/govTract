import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bidWorkspaces } from "./canonical-schema";
import { opportunities, opportunityDocuments, opportunityDocumentVersions } from "./schema";
import { savedOpportunities } from "./saved-opportunities-schema";

export const sourceBinaryArtifacts = pgTable(
  "source_binary_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checksumSha256: text("checksum_sha256").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    byteCount: bigint("byte_count", { mode: "number" }).notNull(),
    mimeType: text("mime_type"),
    etag: text("etag"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_binary_artifacts_checksum_uidx").on(table.checksumSha256),
    uniqueIndex("source_binary_artifacts_provider_key_uidx").on(
      table.storageProvider,
      table.storageKey,
    ),
    check(
      "source_binary_artifacts_checksum_check",
      sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("source_binary_artifacts_byte_count_check", sql`${table.byteCount} >= 0`),
  ],
);

export const pursuitDocumentSnapshots = pgTable(
  "pursuit_document_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    savedOpportunityId: uuid("saved_opportunity_id").references(() => savedOpportunities.id, {
      onDelete: "cascade",
    }),
    bidWorkspaceId: uuid("bid_workspace_id").references(() => bidWorkspaces.id, {
      onDelete: "set null",
    }),
    supersedesSnapshotId: uuid("supersedes_snapshot_id"),
    documentSetFingerprint: text("document_set_fingerprint").notNull(),
    status: text("status").notNull().default("incomplete"),
    totalDocumentCount: integer("total_document_count").notNull().default(0),
    storedDocumentCount: integer("stored_document_count").notNull().default(0),
    blockedDocumentCount: integer("blocked_document_count").notNull().default(0),
    failedDocumentCount: integer("failed_document_count").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pursuit_snapshots_saved_fingerprint_uidx")
      .on(table.savedOpportunityId, table.documentSetFingerprint)
      .where(sql`${table.savedOpportunityId} IS NOT NULL`),
    uniqueIndex("pursuit_snapshots_workspace_fingerprint_uidx")
      .on(table.bidWorkspaceId, table.documentSetFingerprint)
      .where(sql`${table.bidWorkspaceId} IS NOT NULL`),
    index("pursuit_snapshots_opportunity_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
    index("pursuit_snapshots_status_idx").on(table.status, table.updatedAt),
    check(
      "pursuit_snapshots_context_check",
      sql`${table.savedOpportunityId} IS NOT NULL OR ${table.bidWorkspaceId} IS NOT NULL`,
    ),
    check(
      "pursuit_snapshots_status_check",
      sql`${table.status} IN ('incomplete', 'complete', 'blocked')`,
    ),
  ],
);

export const pursuitSnapshotDocuments = pgTable(
  "pursuit_snapshot_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pursuitSnapshotId: uuid("pursuit_snapshot_id")
      .notNull()
      .references(() => pursuitDocumentSnapshots.id, { onDelete: "cascade" }),
    opportunityDocumentId: uuid("opportunity_document_id")
      .notNull()
      .references(() => opportunityDocuments.id, { onDelete: "cascade" }),
    opportunityDocumentVersionId: uuid("opportunity_document_version_id")
      .notNull()
      .references(() => opportunityDocumentVersions.id, { onDelete: "cascade" }),
    sourceBinaryArtifactId: uuid("source_binary_artifact_id").references(
      () => sourceBinaryArtifacts.id,
      { onDelete: "restrict" },
    ),
    source: text("source").notNull(),
    sourceOpportunityId: text("source_opportunity_id").notNull(),
    sourceDocumentKey: text("source_document_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    checksumSha256: text("checksum_sha256"),
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pursuit_snapshot_documents_version_uidx").on(
      table.pursuitSnapshotId,
      table.opportunityDocumentVersionId,
    ),
    index("pursuit_snapshot_documents_snapshot_status_idx").on(
      table.pursuitSnapshotId,
      table.status,
    ),
    index("pursuit_snapshot_documents_artifact_idx").on(table.sourceBinaryArtifactId),
    check(
      "pursuit_snapshot_documents_status_check",
      sql`${table.status} IN ('pending', 'stored', 'missing', 'blocked', 'failed')`,
    ),
  ],
);
