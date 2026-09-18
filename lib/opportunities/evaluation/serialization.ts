import type {
  OpportunityDecisionRecord,
  OpportunityEvaluationRecord,
} from "./persistence";

export function serializeOpportunityEvaluation(evaluation: OpportunityEvaluationRecord | null) {
  if (!evaluation) return null;
  return {
    ...evaluation,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    createdAt: evaluation.createdAt.toISOString(),
    updatedAt: evaluation.updatedAt.toISOString(),
  };
}

export function serializeOpportunityDecision(decision: OpportunityDecisionRecord | null) {
  if (!decision) return null;
  return {
    ...decision,
    decidedAt: decision.decidedAt.toISOString(),
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}
