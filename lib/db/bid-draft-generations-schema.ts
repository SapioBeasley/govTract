import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { bidSections, bidWorkspaces } from "./canonical-schema";

const emptyArray = sql`'[]'::jsonb`;
const emptyObject = sql`'{}'::jsonb`;

/**
 * Append-only audit record per explicit user click. Request IDs prevent accidental
 * duplicate paid model invocations when the same HTTP request is retried.
 */
export const bidDraftGenerations = pgTable(
  "bid_draft_generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bidWorkspaceId: uuid("bid_workspace_id").notNull()
      .references(() => bidWorkspaces.id, { onDelete: "cascade" }),
    bidSectionId: uuid("bid_section_id").notNull()
      .references(() => bidSections.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    generationTrigger: text("generation_trigger").notNull().default("manual"),
    status: text("status").notNull().default("pending"),
    applied: boolean("applied").notNull().default(false),
    sourceSnapshotId: uuid("source_snapshot_id").notNull(),
    documentSetFingerprint: text("document_set_fingerprint").notNull(),
    understandingId: uuid("understanding_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    documentVersions: jsonb("document_versions").$type<Array<{
      versionId: string; snapshotDocumentId: string; filename: string; checksumSha256: string;
    }>>().notNull().default(emptyArray),
    requirementKeys: jsonb("requirement_keys").$type<string[]>().notNull().default(emptyArray),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    modelVersion: text("model_version"),
    pricingProfileVersion: text("pricing_profile_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    generatedContent: text("generated_content"),
    missingFacts: jsonb("missing_facts").$type<string[]>().notNull().default(emptyArray),
    usageMetadata: jsonb("usage_metadata").$type<Record<string, unknown>>().notNull().default(emptyObject),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
    actualCostMicrousd: bigint("actual_cost_microusd", { mode: "number" }),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bid_draft_generations_section_request_uidx").on(table.bidSectionId, table.requestId),
    index("bid_draft_generations_workspace_created_idx").on(table.bidWorkspaceId, table.createdAt),
    index("bid_draft_generations_section_created_idx").on(table.bidSectionId, table.createdAt),
    check("bid_draft_generations_trigger_check", sql`${table.generationTrigger} = 'manual'`),
    check("bid_draft_generations_status_check", sql`${table.status} IN ('pending', 'completed', 'failed')`),
    check("bid_draft_generations_cost_check",
      sql`(${table.estimatedCostMicrousd} IS NULL OR ${table.estimatedCostMicrousd} >= 0)
        AND (${table.actualCostMicrousd} IS NULL OR ${table.actualCostMicrousd} >= 0)`),
  ],
);
