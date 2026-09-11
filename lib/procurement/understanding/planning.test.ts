import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UNDERSTANDING_BUDGET_POLICY,
  authorizeUnderstandingRun,
  estimateMaximumCostMicrousd,
  evaluateModelCallBudget,
  evaluateUnderstandingFreshness,
  loadUnderstandingBudgetPolicyFromEnv,
  planUnderstandingInputs,
  type UnderstandingDocumentInput,
  type UnderstandingModelPricingProfile,
} from "./planning";

const billableProfile: UnderstandingModelPricingProfile = {
  id: "fixture-billable-v1",
  provider: "fixture",
  model: "fixture-model",
  billingMode: "billable",
  inputTokenLimit: 1_000_000,
  outputTokenLimit: 32_000,
  inputCostMicrousdPerMillionTokens: 750_000,
  outputCostMicrousdPerMillionTokens: 3_750_000,
};

const nonBillableProfile: UnderstandingModelPricingProfile = {
  ...billableProfile,
  id: "fixture-free-v1",
  billingMode: "non_billable",
};

function document(
  documentVersionId: string,
  content: string,
  options: Partial<UnderstandingDocumentInput> = {},
): UnderstandingDocumentInput {
  return {
    documentVersionId,
    extractionId: `${documentVersionId}-extraction`,
    checksumSha256: `${documentVersionId}-checksum`,
    extractorName: "fixture-extractor",
    extractorVersion: "1",
    extractionStatus: "extracted",
    truncated: false,
    segments: [
      {
        id: `${documentVersionId}-segment-0`,
        ordinal: 0,
        content,
        contentHashSha256: `${documentVersionId}-segment-hash`,
      },
    ],
    ...options,
  };
}

test("default paid-AI budget is zero for automatic and manual understanding", () => {
  assert.equal(DEFAULT_UNDERSTANDING_BUDGET_POLICY.automaticMaxCostMicrousd, 0);
  assert.equal(DEFAULT_UNDERSTANDING_BUDGET_POLICY.manualMaxCostMicrousd, 0);
});

test("budget policy can be raised later through runtime configuration without changing planner logic", () => {
  const configured = loadUnderstandingBudgetPolicyFromEnv({
    GOVTRACT_AI_AUTOMATIC_BUDGET_USD: "0.25",
    GOVTRACT_AI_MANUAL_BUDGET_USD: "1.5",
    GOVTRACT_AI_UNDERSTANDING_PER_DOCUMENT_CHAR_BUDGET: "1234",
    GOVTRACT_AI_UNDERSTANDING_PER_OPPORTUNITY_CHAR_BUDGET: "5678",
    GOVTRACT_AI_UNDERSTANDING_MAX_CHUNK_CHARS: "321",
    GOVTRACT_AI_UNDERSTANDING_MAX_OUTPUT_TOKENS_PER_CALL: "2048",
  });

  assert.deepEqual(configured, {
    automaticMaxCostMicrousd: 250_000,
    manualMaxCostMicrousd: 1_500_000,
    perDocumentCharBudget: 1_234,
    perOpportunityCharBudget: 5_678,
    maxChunkChars: 321,
    maxOutputTokensPerCall: 2_048,
  });
});

test("estimates maximum cost from bounded input/output token budgets", () => {
  assert.equal(
    estimateMaximumCostMicrousd({
      profile: billableProfile,
      inputTokenBudget: 1_000,
      outputTokenBudget: 100,
    }),
    1_125,
  );
});

test("zero-dollar policy blocks potentially billable calls but permits explicitly non-billable execution", () => {
  const blocked = evaluateModelCallBudget({
    profile: billableProfile,
    inputTokenBudget: 1_000,
    outputTokenBudget: 100,
    maxCostMicrousd: 0,
    spentCostMicrousd: 0,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    estimatedCostMicrousd: 1_125,
    remainingCostMicrousd: 0,
    reason: "budget_exceeded",
  });

  const free = evaluateModelCallBudget({
    profile: nonBillableProfile,
    inputTokenBudget: 1_000,
    outputTokenBudget: 100,
    maxCostMicrousd: 0,
    spentCostMicrousd: 0,
  });
  assert.equal(free.allowed, true);
  assert.equal(free.estimatedCostMicrousd, 0);
});

test("run authorization permits one automatic cycle and requires explicit user action for manual runs", () => {
  assert.equal(
    authorizeUnderstandingRun({
      trigger: "automatic_initial",
      automaticRunExists: false,
      explicitManualUserAction: false,
    }).allowed,
    true,
  );

  assert.deepEqual(
    authorizeUnderstandingRun({
      trigger: "automatic_initial",
      automaticRunExists: true,
      explicitManualUserAction: false,
    }),
    { allowed: false, reason: "automatic_run_already_exists" },
  );

  assert.deepEqual(
    authorizeUnderstandingRun({
      trigger: "manual",
      automaticRunExists: true,
      explicitManualUserAction: false,
    }),
    { allowed: false, reason: "manual_user_action_required" },
  );

  assert.equal(
    authorizeUnderstandingRun({
      trigger: "manual",
      automaticRunExists: true,
      explicitManualUserAction: true,
    }).allowed,
    true,
  );
});

test("changed fingerprints mark output stale without authorizing automatic regeneration", () => {
  assert.deepEqual(
    evaluateUnderstandingFreshness({
      previousInputFingerprint: "old",
      currentInputFingerprint: "new",
    }),
    { isStale: true, shouldAutomaticallyRegenerate: false, staleReason: "input_changed" },
  );
  assert.deepEqual(
    evaluateUnderstandingFreshness({
      previousInputFingerprint: "same",
      currentInputFingerprint: "same",
    }),
    { isStale: false, shouldAutomaticallyRegenerate: false, staleReason: null },
  );
});

test("planning is deterministic, bounded, marks budget-limited results partial, and reuses compatible chunks", () => {
  const documents = [document("doc-b", "IJKLMNOP"), document("doc-a", "ABCDEFGH")];
  const config = {
    perDocumentCharBudget: 8,
    perOpportunityCharBudget: 8,
    maxChunkChars: 4,
    promptVersion: "understanding-v1",
    modelProvider: "fixture",
    modelName: "fixture-model",
    modelVersion: "1",
  };

  const first = planUnderstandingInputs({ documents, config });
  const repeated = planUnderstandingInputs({ documents: [...documents].reverse(), config });

  assert.deepEqual(first, repeated);
  assert.equal(first.completenessStatus, "partial");
  assert.equal(first.incompleteReason, "budget_limit");
  assert.deepEqual(first.coverage, {
    documentsTotal: 2,
    documentsProcessed: 1,
    documentsSkipped: 1,
    chunksTotal: 4,
    chunksProcessed: 2,
    chunksReused: 0,
    chunksSkipped: 2,
  });
  assert.deepEqual(
    first.chunks.map((chunk) => [chunk.documentVersionId, chunk.ordinal, chunk.status]),
    [
      ["doc-a", 0, "planned"],
      ["doc-a", 1, "planned"],
      ["doc-b", 0, "skipped"],
      ["doc-b", 1, "skipped"],
    ],
  );

  const reusableFingerprints = new Set(
    first.chunks.filter((chunk) => chunk.status === "planned").map((chunk) => chunk.inputFingerprint),
  );
  const resumed = planUnderstandingInputs({ documents, config, reusableFingerprints });

  assert.equal(resumed.completenessStatus, "complete");
  assert.equal(resumed.incompleteReason, null);
  assert.deepEqual(resumed.coverage, {
    documentsTotal: 2,
    documentsProcessed: 2,
    documentsSkipped: 0,
    chunksTotal: 4,
    chunksProcessed: 2,
    chunksReused: 2,
    chunksSkipped: 0,
  });
});

test("partial extraction and unsupported documents remain explicit completeness reasons", () => {
  const config = {
    perDocumentCharBudget: 100,
    perOpportunityCharBudget: 100,
    maxChunkChars: 50,
    promptVersion: "understanding-v1",
    modelProvider: "fixture",
    modelName: "fixture-model",
    modelVersion: "1",
  };

  const truncated = planUnderstandingInputs({
    documents: [document("doc-a", "content", { truncated: true })],
    config,
  });
  assert.equal(truncated.completenessStatus, "partial");
  assert.equal(truncated.incompleteReason, "extraction_partial");

  const unsupported = planUnderstandingInputs({
    documents: [
      document("doc-a", "content"),
      document("doc-b", "", { extractionStatus: "unsupported", segments: [] }),
    ],
    config,
  });
  assert.equal(unsupported.completenessStatus, "partial");
  assert.equal(unsupported.incompleteReason, "unsupported_document");
});
