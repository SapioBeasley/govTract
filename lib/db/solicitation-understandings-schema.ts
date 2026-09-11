import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { SolicitationUnderstandingContent } from "@/lib/procurement/understanding/types";
import type {
  UnderstandingCompletenessStatus,
  UnderstandingIncompleteReason,
} from "@/lib/procurement/understanding/planning";
import { documentExtractions, documentExtractionSegments } from "./document-extractions-schema";
import { opportunities, opportunityDocumentVersions } from "./schema";

const jsonObject = sql`'{}'::jsonb`;

export const solicitationUnderstandings = pgTable(
  "solicitation_understandings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    inputFingerprint: text("input_fingerprint").notNull(),
    schemaVersion: text("schema_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    modelVersion: text("model_version"),
    generationTrigger: text("generation_trigger").notNull(),
    status: text("status").notNull().default("pending"),
    completenessStatus: text("completeness_status")
      .$type<UnderstandingCompletenessStatus>()
      .notNull()
      .default("partial"),
    incompleteReason: text("incomplete_reason").$type<UnderstandingIncompleteReason>(),
    coverageMetadata: jsonb("coverage_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    budgetMicrousd: bigint("budget_microusd", { mode: "number" }).notNull().default(0),
    pricingProfileVersion: text("pricing_profile_version"),
    structuredOutput: jsonb("structured_output").$type<SolicitationUnderstandingContent>(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingCompletedAt: timestamp("processing_completed_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    isStale: boolean("is_stale").notNull().default(false),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    staleReason: text("stale_reason"),
    failureCode: text("failure_code"),
    inputTokenCount: bigint("input_token_count", { mode: "number" }),
    outputTokenCount: bigint("output_token_count", { mode: "number" }),
    inputCharCount: bigint("input_char_count", { mode: "number" }),
    outputCharCount: bigint("output_char_count", { mode: "number" }),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
    actualCostMicrousd: bigint("actual_cost_microusd", { mode: "number" }),
    usageMetadata: jsonb("usage_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("solicitation_understandings_one_automatic_uidx")
      .on(table.opportunityId)
      .where(sql`${table.generationTrigger} = 'automatic_initial'`),
    index("solicitation_understandings_opportunity_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
    index("solicitation_understandings_opportunity_stale_idx").on(
      table.opportunityId,
      table.isStale,
    ),
    check(
      "solicitation_understandings_generation_trigger_check",
      sql`${table.generationTrigger} IN ('automatic_initial', 'manual')`,
    ),
    check(
      "solicitation_understandings_status_check",
      sql`${table.status} IN ('pending', 'completed', 'failed')`,
    ),
    check(
      "solicitation_understandings_completeness_check",
      sql`${table.completenessStatus} IN ('complete', 'partial')`,
    ),
    check(
      "solicitation_understandings_completed_output_check",
      sql`${table.status} <> 'completed' OR ${table.structuredOutput} IS NOT NULL`,
    ),
    check(
      "solicitation_understandings_stale_timestamp_check",
      sql`NOT ${table.isStale} OR ${table.staleAt} IS NOT NULL`,
    ),
    check(
      "solicitation_understandings_budget_nonnegative_check",
      sql`${table.budgetMicrousd} >= 0`,
    ),
    check(
      "solicitation_understandings_usage_nonnegative_check",
      sql`(${table.inputTokenCount} IS NULL OR ${table.inputTokenCount} >= 0)
        AND (${table.outputTokenCount} IS NULL OR ${table.outputTokenCount} >= 0)
        AND (${table.inputCharCount} IS NULL OR ${table.inputCharCount} >= 0)
        AND (${table.outputCharCount} IS NULL OR ${table.outputCharCount} >= 0)
        AND (${table.estimatedCostMicrousd} IS NULL OR ${table.estimatedCostMicrousd} >= 0)
        AND (${table.actualCostMicrousd} IS NULL OR ${table.actualCostMicrousd} >= 0)`,
    ),
  ],
);

export const solicitationUnderstandingInputs = pgTable(
  "solicitation_understanding_inputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solicitationUnderstandingId: uuid("solicitation_understanding_id")
      .notNull()
      .references(() => solicitationUnderstandings.id, { onDelete: "cascade" }),
    opportunityDocumentVersionId: uuid("opportunity_document_version_id")
      .notNull()
      .references(() => opportunityDocumentVersions.id, { onDelete: "cascade" }),
    documentExtractionId: uuid("document_extraction_id").references(() => documentExtractions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("solicitation_understanding_inputs_version_uidx").on(
      table.solicitationUnderstandingId,
      table.opportunityDocumentVersionId,
    ),
    index("solicitation_understanding_inputs_version_idx").on(table.opportunityDocumentVersionId),
  ],
);

export const solicitationUnderstandingChunks = pgTable(
  "solicitation_understanding_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solicitationUnderstandingId: uuid("solicitation_understanding_id")
      .notNull()
      .references(() => solicitationUnderstandings.id, { onDelete: "cascade" }),
    opportunityDocumentVersionId: uuid("opportunity_document_version_id")
      .notNull()
      .references(() => opportunityDocumentVersions.id, { onDelete: "cascade" }),
    documentExtractionId: uuid("document_extraction_id").references(() => documentExtractions.id, {
      onDelete: "set null",
    }),
    chunkKey: text("chunk_key").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    ordinal: integer("ordinal").notNull(),
    status: text("status").notNull().default("planned"),
    charCount: bigint("char_count", { mode: "number" }).notNull(),
    estimatedInputTokenCount: bigint("estimated_input_token_count", { mode: "number" }),
    outputTokenCount: bigint("output_token_count", { mode: "number" }),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
    actualCostMicrousd: bigint("actual_cost_microusd", { mode: "number" }),
    pricingProfileVersion: text("pricing_profile_version"),
    structuredOutput: jsonb("structured_output").$type<Record<string, unknown>>(),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("solicitation_understanding_chunks_key_uidx").on(
      table.solicitationUnderstandingId,
      table.chunkKey,
    ),
    index("solicitation_understanding_chunks_fingerprint_idx").on(table.inputFingerprint),
    index("solicitation_understanding_chunks_version_idx").on(table.opportunityDocumentVersionId),
    check(
      "solicitation_understanding_chunks_status_check",
      sql`${table.status} IN ('planned', 'processed', 'reused', 'skipped')`,
    ),
    check(
      "solicitation_understanding_chunks_usage_nonnegative_check",
      sql`${table.charCount} >= 0
        AND (${table.estimatedInputTokenCount} IS NULL OR ${table.estimatedInputTokenCount} >= 0)
        AND (${table.outputTokenCount} IS NULL OR ${table.outputTokenCount} >= 0)
        AND (${table.estimatedCostMicrousd} IS NULL OR ${table.estimatedCostMicrousd} >= 0)
        AND (${table.actualCostMicrousd} IS NULL OR ${table.actualCostMicrousd} >= 0)`,
    ),
  ],
);

export const solicitationUnderstandingEvidence = pgTable(
  "solicitation_understanding_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solicitationUnderstandingId: uuid("solicitation_understanding_id")
      .notNull()
      .references(() => solicitationUnderstandings.id, { onDelete: "cascade" }),
    findingKey: text("finding_key").notNull(),
    opportunityDocumentVersionId: uuid("opportunity_document_version_id")
      .notNull()
      .references(() => opportunityDocumentVersions.id, { onDelete: "cascade" }),
    documentExtractionSegmentId: uuid("document_extraction_segment_id").references(
      () => documentExtractionSegments.id,
      { onDelete: "set null" },
    ),
    locator: jsonb("locator").$type<Record<string, unknown>>().notNull().default(jsonObject),
    excerpt: text("excerpt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("solicitation_understanding_evidence_finding_idx").on(
      table.solicitationUnderstandingId,
      table.findingKey,
    ),
    index("solicitation_understanding_evidence_version_idx").on(
      table.opportunityDocumentVersionId,
    ),
    index("solicitation_understanding_evidence_segment_idx").on(
      table.documentExtractionSegmentId,
    ),
  ],
);
