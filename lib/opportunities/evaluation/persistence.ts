import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  opportunityEvaluationDecisions,
  opportunityEvaluations,
} from "@/lib/db/opportunity-evaluations-schema";
import type {
  OpportunityAssessmentState,
  OpportunityEvaluationFactor,
  OpportunityEvaluationResult,
} from "./rules";

export const opportunityDecisionValues = ["pursue", "do_not_pursue", "revisit"] as const;
export type OpportunityDecision = (typeof opportunityDecisionValues)[number];

export function isOpportunityDecision(value: unknown): value is OpportunityDecision {
  return (
    typeof value === "string" &&
    (opportunityDecisionValues as readonly string[]).includes(value)
  );
}

export type OpportunityEvaluationRecord = {
  id: string;
  opportunityId: string;
  companyProfileId: string;
  solicitationUnderstandingId: string | null;
  inputFingerprint: string;
  ruleVersion: string;
  assessment: OpportunityAssessmentState;
  factors: OpportunityEvaluationFactor[];
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type OpportunityDecisionRecord = {
  id: string;
  opportunityId: string;
  companyProfileId: string;
  evaluationId: string | null;
  decision: OpportunityDecision;
  decidedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeEvaluation(
  row: typeof opportunityEvaluations.$inferSelect,
): OpportunityEvaluationRecord {
  return {
    ...row,
    assessment: row.assessment,
    factors: row.factors,
  };
}

function normalizeDecision(
  row: typeof opportunityEvaluationDecisions.$inferSelect,
): OpportunityDecisionRecord {
  if (!isOpportunityDecision(row.decision)) {
    throw new Error("Stored opportunity decision is invalid.");
  }
  return { ...row, decision: row.decision };
}

export async function persistOpportunityEvaluation(input: {
  opportunityId: string;
  companyProfileId: string;
  solicitationUnderstandingId: string | null;
  result: OpportunityEvaluationResult;
}): Promise<OpportunityEvaluationRecord> {
  const db = getDb();
  const [created] = await db
    .insert(opportunityEvaluations)
    .values({
      opportunityId: input.opportunityId,
      companyProfileId: input.companyProfileId,
      solicitationUnderstandingId: input.solicitationUnderstandingId,
      inputFingerprint: input.result.inputFingerprint,
      ruleVersion: input.result.ruleVersion,
      assessment: input.result.assessment,
      factors: input.result.factors,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return normalizeEvaluation(created);

  const [existing] = await db
    .select()
    .from(opportunityEvaluations)
    .where(
      and(
        eq(opportunityEvaluations.opportunityId, input.opportunityId),
        eq(opportunityEvaluations.companyProfileId, input.companyProfileId),
        eq(opportunityEvaluations.inputFingerprint, input.result.inputFingerprint),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Opportunity evaluation could not be persisted.");
  return normalizeEvaluation(existing);
}

export async function loadLatestOpportunityEvaluation(
  opportunityId: string,
  companyProfileId: string,
): Promise<OpportunityEvaluationRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(opportunityEvaluations)
    .where(
      and(
        eq(opportunityEvaluations.opportunityId, opportunityId),
        eq(opportunityEvaluations.companyProfileId, companyProfileId),
      ),
    )
    .orderBy(desc(opportunityEvaluations.evaluatedAt), desc(opportunityEvaluations.id))
    .limit(1);
  return row ? normalizeEvaluation(row) : null;
}

export async function recordOpportunityDecision(input: {
  opportunityId: string;
  companyProfileId: string;
  evaluationId: string | null;
  decision: OpportunityDecision;
}): Promise<OpportunityDecisionRecord> {
  if (!isOpportunityDecision(input.decision)) {
    throw new Error("Invalid opportunity decision.");
  }
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(opportunityEvaluationDecisions)
    .values({
      opportunityId: input.opportunityId,
      companyProfileId: input.companyProfileId,
      evaluationId: input.evaluationId,
      decision: input.decision,
      decidedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        opportunityEvaluationDecisions.opportunityId,
        opportunityEvaluationDecisions.companyProfileId,
      ],
      set: {
        evaluationId: input.evaluationId,
        decision: input.decision,
        decidedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error("Opportunity decision could not be persisted.");
  return normalizeDecision(row);
}

export async function getOpportunityDecision(
  opportunityId: string,
  companyProfileId: string,
): Promise<OpportunityDecisionRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(opportunityEvaluationDecisions)
    .where(
      and(
        eq(opportunityEvaluationDecisions.opportunityId, opportunityId),
        eq(opportunityEvaluationDecisions.companyProfileId, companyProfileId),
      ),
    )
    .limit(1);
  return row ? normalizeDecision(row) : null;
}
