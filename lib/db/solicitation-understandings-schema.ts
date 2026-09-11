import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { SolicitationUnderstandingContent } from "@/lib/procurement/understanding/types";
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
      "solicitation_understandings_completed_output_check",
      sql`${table.status} <> 'completed' OR ${table.structuredOutput} IS NOT NULL`,
    ),
    check(
      "solicitation_understandings_stale_timestamp_check",
      sql`NOT ${table.isStale} OR ${table.staleAt} IS NOT NULL`,
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
