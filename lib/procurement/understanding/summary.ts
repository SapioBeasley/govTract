import type { UnderstandingInputPlan } from "./planning";

export type UnderstandingUsageSummary = {
  inputTokenCount?: number | null;
  outputTokenCount?: number | null;
  estimatedCostMicrousd?: number | null;
  actualCostMicrousd?: number | null;
};

export function summarizeUnderstandingBatch(input: {
  plan: UnderstandingInputPlan;
  usage?: UnderstandingUsageSummary;
}) {
  return {
    ...input.plan.coverage,
    completenessStatus: input.plan.completenessStatus,
    incompleteReason: input.plan.incompleteReason,
    inputTokenCount: input.usage?.inputTokenCount ?? null,
    outputTokenCount: input.usage?.outputTokenCount ?? null,
    estimatedCostMicrousd: input.usage?.estimatedCostMicrousd ?? null,
    actualCostMicrousd: input.usage?.actualCostMicrousd ?? null,
  };
}
