import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type {
  SolicitationRequirementLevel,
  SolicitationRequirementSourceSection,
  SolicitationRequirementType,
} from "@/lib/procurement/requirements/derive";
import { solicitationUnderstandings } from "./solicitation-understandings-schema";
import { opportunities } from "./schema";

const jsonObject = sql`'{}'::jsonb`;

export const solicitationRequirements = pgTable(
  "solicitation_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    solicitationUnderstandingId: uuid("solicitation_understanding_id")
      .notNull()
      .references(() => solicitationUnderstandings.id, { onDelete: "cascade" }),
    requirementKey: text("requirement_key").notNull(),
    requirementType: text("requirement_type").$type<SolicitationRequirementType>().notNull(),
    requirementLevel: text("requirement_level").$type<SolicitationRequirementLevel>().notNull(),
    text: text("text").notNull(),
    sourceSection: text("source_section").$type<SolicitationRequirementSourceSection>().notNull(),
    sourceFindingKey: text("source_finding_key").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("solicitation_requirements_understanding_key_uidx").on(
      table.solicitationUnderstandingId,
      table.requirementKey,
    ),
    index("solicitation_requirements_opportunity_idx").on(table.opportunityId),
    index("solicitation_requirements_type_idx").on(table.requirementType),
    index("solicitation_requirements_source_finding_idx").on(
      table.solicitationUnderstandingId,
      table.sourceFindingKey,
    ),
    check(
      "solicitation_requirements_type_check",
      sql`${table.requirementType} IN (
        'scope', 'deliverable', 'work', 'location', 'deadline', 'schedule', 'quantity',
        'qualification', 'license', 'certification', 'insurance', 'bonding', 'insurance_bonding',
        'mandatory_event', 'pricing', 'form', 'submission_instruction', 'evaluation', 'disqualifier'
      )`,
    ),
    check(
      "solicitation_requirements_level_check",
      sql`${table.requirementLevel} IN ('required', 'optional', 'unknown')`,
    ),
    check(
      "solicitation_requirements_source_section_check",
      sql`${table.sourceSection} IN (
        'scope', 'deliverables', 'workBreakdown', 'location', 'schedule', 'quantities',
        'qualifications', 'insuranceBonding', 'mandatoryEvents', 'pricingInstructions',
        'submissionComponents', 'evaluationCriteria', 'disqualifiers'
      )`,
    ),
  ],
);
