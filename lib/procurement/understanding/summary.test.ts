import assert from "node:assert/strict";
import test from "node:test";

import type { UnderstandingInputPlan } from "./planning";
import { summarizeUnderstandingBatch } from "./summary";

const plan: UnderstandingInputPlan = {
  inputFingerprint: "fixture",
  chunks: [],
  coverage: {
    documentsTotal: 5,
    documentsProcessed: 3,
    documentsSkipped: 2,
    chunksTotal: 12,
    chunksProcessed: 6,
    chunksReused: 4,
    chunksSkipped: 2,
  },
  completenessStatus: "partial",
  incompleteReason: "budget_limit",
};

test("batch summary includes coverage, completeness, and available model usage", () => {
  assert.deepEqual(
    summarizeUnderstandingBatch({
      plan,
      usage: {
        inputTokenCount: 1_200,
        outputTokenCount: 300,
        estimatedCostMicrousd: 1_500,
        actualCostMicrousd: 1_250,
      },
    }),
    {
      ...plan.coverage,
      completenessStatus: "partial",
      incompleteReason: "budget_limit",
      inputTokenCount: 1_200,
      outputTokenCount: 300,
      estimatedCostMicrousd: 1_500,
      actualCostMicrousd: 1_250,
    },
  );
});
