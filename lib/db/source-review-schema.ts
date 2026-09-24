import { index, uniqueIndex, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bidRequirements, bidWorkspaces } from "./canonical-schema";

export const bidRequirementSourceReviews = pgTable("bid_requirement_source_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  bidWorkspaceId: uuid("bid_workspace_id").notNull().references(() => bidWorkspaces.id, { onDelete: "cascade" }),
  bidRequirementId: uuid("bid_requirement_id").notNull().references(() => bidRequirements.id, { onDelete: "cascade" }),
  understandingId: uuid("understanding_id").notNull(),
  sourceRequirementId: uuid("source_requirement_id").notNull(),
  snapshotId: uuid("snapshot_id").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  level: text("level").$type<"required" | "optional">().notNull(),
  documentVersionId: uuid("document_version_id").notNull(),
  documentChecksum: text("document_checksum").notNull(),
  snapshotDocumentId: uuid("snapshot_document_id").notNull(),
  segmentId: uuid("segment_id").notNull(),
  locator: jsonb("locator").$type<Record<string, unknown>>().notNull(),
  excerpt: text("excerpt").notNull(),
  reviewerNote: text("reviewer_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bid_source_reviews_requirement_created_idx").on(table.bidRequirementId, table.createdAt),
  index("bid_source_reviews_workspace_idx").on(table.bidWorkspaceId),
  uniqueIndex("bid_source_reviews_determination_uidx").on(table.bidRequirementId,
    table.understandingId, table.snapshotId, table.sourceFingerprint, table.level,
    table.documentVersionId, table.excerpt),
]);
