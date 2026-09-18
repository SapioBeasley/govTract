import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type {
  OpportunityAssessmentState,
  OpportunityEvaluationFactor,
} from "@/lib/opportunities/evaluation/rules";
import { companyProfiles } from "./canonical-schema";
import { opportunities } from "./schema";
import { solicitationUnderstandings } from "./solicitation-understandings-schema";

const jsonArray = sql\`'[]'::jsonb\`;

export const opportunityEvaluations = pgTable(
  "opportunity_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    solicitationUnderstandingId: uuid("solicitation_understanding_id").references(
      () => solicitationUnderstandings.id,
      { onDelete: "set null" },
    ),
    inputFingerprint: text("input_fingerprint").notNull(),
    ruleVersion: text("rule_version").notNull(),
    assessment: text("assessment").$type<OpportunityAssessmentState>().notNull(),
    factors: jsonb("factors").$type<OpportunityEvaluationFactor[]>().notNull().default(jsonArray),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_evaluations_input_uidx").on(
      table.opportunityId,
      table.companyProfileId,
      table.inputFingerprint,
    ),
    index("opportunity_evaluations_latest_idx").on(
      table.opportunityId,
      table.companyProfileId,
      table.evaluatedAt,
    ),
    check(
      "opportunity_evaluations_assessment_check",
      sql\`${table.assessment} IN ('go', 'conditional', 'no_go')\`,
    ),
  ],
);

export const opportunityEvaluationDecisions = pgTable(
  "opportunity_evaluation_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    evaluationId: uuid("evaluation_id").references(() => opportunityEvaluations.id, {
      onDelete: "set null",
    }),
    decision: text("decision").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_evaluation_decisions_opportunity_profile_uidx").on(
      table.opportunityId,
      table.companyProfileId,
    ),
    index("opportunity_evaluation_decisions_decision_idx").on(table.decision, table.updatedAt),
    check(
      "opportunity_evaluation_decisions_value_check",
      sql\`${table.decision} IN ('pursue', 'do_not_pursue', 'revisit')\`,
    ),
  ],
);
