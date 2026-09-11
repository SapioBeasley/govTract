import { createHash } from "node:crypto";

export type UnderstandingGenerationTrigger = "automatic_initial" | "manual";
export type UnderstandingCompletenessStatus = "complete" | "partial";
export type UnderstandingIncompleteReason =
  | "budget_limit"
  | "unsupported_document"
  | "extraction_partial"
  | "chunk_failure";

export type UnderstandingBudgetPolicy = {
  automaticMaxCostMicrousd: number;
  manualMaxCostMicrousd: number;
  perDocumentCharBudget: number;
  perOpportunityCharBudget: number;
  maxChunkChars: number;
  maxOutputTokensPerCall: number;
};

export const DEFAULT_UNDERSTANDING_BUDGET_POLICY: Readonly<UnderstandingBudgetPolicy> = {
  automaticMaxCostMicrousd: 0,
  manualMaxCostMicrousd: 0,
  perDocumentCharBudget: 200_000,
  perOpportunityCharBudget: 600_000,
  maxChunkChars: 32_000,
  maxOutputTokensPerCall: 8_192,
};

export type UnderstandingModelPricingProfile = {
  id: string;
  provider: string;
  model: string;
  billingMode: "billable" | "non_billable";
  inputTokenLimit: number;
  outputTokenLimit: number;
  inputCostMicrousdPerMillionTokens: number;
  outputCostMicrousdPerMillionTokens: number;
};

export type UnderstandingExtractionStatus = "extracted" | "pending" | "failed" | "unsupported";

export type UnderstandingSegmentInput = {
  id: string;
  ordinal: number;
  content: string;
  contentHashSha256: string;
};

export type UnderstandingDocumentInput = {
  documentVersionId: string;
  extractionId: string | null;
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
  extractionStatus: UnderstandingExtractionStatus;
  truncated: boolean;
  segments: UnderstandingSegmentInput[];
};

export type UnderstandingPlanningConfig = {
  perDocumentCharBudget: number;
  perOpportunityCharBudget: number;
  maxChunkChars: number;
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  modelVersion: string | null;
};

export type UnderstandingPlannedChunk = {
  chunkKey: string;
  documentVersionId: string;
  extractionId: string | null;
  segmentId: string;
  ordinal: number;
  part: number;
  content: string;
  charCount: number;
  inputFingerprint: string;
  status: "planned" | "reused" | "skipped";
  skipReason: "budget_limit" | null;
};

export type UnderstandingCoverage = {
  documentsTotal: number;
  documentsProcessed: number;
  documentsSkipped: number;
  chunksTotal: number;
  chunksProcessed: number;
  chunksReused: number;
  chunksSkipped: number;
};

export type UnderstandingInputPlan = {
  inputFingerprint: string;
  chunks: UnderstandingPlannedChunk[];
  coverage: UnderstandingCoverage;
  completenessStatus: UnderstandingCompletenessStatus;
  incompleteReason: UnderstandingIncompleteReason | null;
};

function assertNonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function hash(parts: readonly string[]) {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(part);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function resolveUnderstandingBudgetPolicy(
  overrides: Partial<UnderstandingBudgetPolicy> = {},
): UnderstandingBudgetPolicy {
  const resolved = { ...DEFAULT_UNDERSTANDING_BUDGET_POLICY, ...overrides };
  assertNonnegativeInteger(resolved.automaticMaxCostMicrousd, "automaticMaxCostMicrousd");
  assertNonnegativeInteger(resolved.manualMaxCostMicrousd, "manualMaxCostMicrousd");
  assertPositiveInteger(resolved.perDocumentCharBudget, "perDocumentCharBudget");
  assertPositiveInteger(resolved.perOpportunityCharBudget, "perOpportunityCharBudget");
  assertPositiveInteger(resolved.maxChunkChars, "maxChunkChars");
  assertPositiveInteger(resolved.maxOutputTokensPerCall, "maxOutputTokensPerCall");
  return resolved;
}

export function estimateMaximumCostMicrousd(input: {
  profile: UnderstandingModelPricingProfile;
  inputTokenBudget: number;
  outputTokenBudget: number;
}) {
  assertNonnegativeInteger(input.inputTokenBudget, "inputTokenBudget");
  assertNonnegativeInteger(input.outputTokenBudget, "outputTokenBudget");

  if (input.profile.billingMode === "non_billable") return 0;

  const inputCost =
    (input.inputTokenBudget * input.profile.inputCostMicrousdPerMillionTokens) / 1_000_000;
  const outputCost =
    (input.outputTokenBudget * input.profile.outputCostMicrousdPerMillionTokens) / 1_000_000;
  return Math.ceil(inputCost + outputCost);
}

export function evaluateModelCallBudget(input: {
  profile: UnderstandingModelPricingProfile;
  inputTokenBudget: number;
  outputTokenBudget: number;
  maxCostMicrousd: number;
  spentCostMicrousd: number;
}):
  | {
      allowed: true;
      estimatedCostMicrousd: number;
      remainingCostMicrousd: number;
      reason: null;
    }
  | {
      allowed: false;
      estimatedCostMicrousd: number;
      remainingCostMicrousd: number;
      reason: "model_input_limit" | "model_output_limit" | "budget_exceeded";
    } {
  assertNonnegativeInteger(input.maxCostMicrousd, "maxCostMicrousd");
  assertNonnegativeInteger(input.spentCostMicrousd, "spentCostMicrousd");
  assertNonnegativeInteger(input.profile.inputTokenLimit, "profile.inputTokenLimit");
  assertNonnegativeInteger(input.profile.outputTokenLimit, "profile.outputTokenLimit");

  const estimatedCostMicrousd = estimateMaximumCostMicrousd(input);
  const remainingCostMicrousd = Math.max(0, input.maxCostMicrousd - input.spentCostMicrousd);

  if (input.inputTokenBudget > input.profile.inputTokenLimit) {
    return {
      allowed: false,
      estimatedCostMicrousd,
      remainingCostMicrousd,
      reason: "model_input_limit",
    };
  }
  if (input.outputTokenBudget > input.profile.outputTokenLimit) {
    return {
      allowed: false,
      estimatedCostMicrousd,
      remainingCostMicrousd,
      reason: "model_output_limit",
    };
  }
  if (estimatedCostMicrousd > remainingCostMicrousd) {
    return {
      allowed: false,
      estimatedCostMicrousd,
      remainingCostMicrousd,
      reason: "budget_exceeded",
    };
  }

  return { allowed: true, estimatedCostMicrousd, remainingCostMicrousd, reason: null };
}

export function authorizeUnderstandingRun(input: {
  trigger: UnderstandingGenerationTrigger;
  automaticRunExists: boolean;
  explicitManualUserAction: boolean;
}):
  | { allowed: true; reason: null }
  | { allowed: false; reason: "automatic_run_already_exists" | "manual_user_action_required" } {
  if (input.trigger === "automatic_initial" && input.automaticRunExists) {
    return { allowed: false, reason: "automatic_run_already_exists" };
  }
  if (input.trigger === "manual" && !input.explicitManualUserAction) {
    return { allowed: false, reason: "manual_user_action_required" };
  }
  return { allowed: true, reason: null };
}

function chunkFingerprint(input: {
  document: UnderstandingDocumentInput;
  segment: UnderstandingSegmentInput;
  part: number;
  content: string;
  config: UnderstandingPlanningConfig;
}) {
  return hash([
    input.document.checksumSha256,
    input.document.extractorName,
    input.document.extractorVersion,
    input.segment.contentHashSha256,
    String(input.part),
    hash([input.content]),
    input.config.promptVersion,
    input.config.modelProvider,
    input.config.modelName,
    input.config.modelVersion ?? "",
  ]);
}

function splitDocument(
  document: UnderstandingDocumentInput,
  config: UnderstandingPlanningConfig,
): Omit<UnderstandingPlannedChunk, "status" | "skipReason">[] {
  const chunks: Omit<UnderstandingPlannedChunk, "status" | "skipReason">[] = [];
  let ordinal = 0;

  const segments = [...document.segments].sort(
    (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
  );
  for (const segment of segments) {
    if (!segment.content) continue;
    let part = 0;
    for (let offset = 0; offset < segment.content.length; offset += config.maxChunkChars) {
      const content = segment.content.slice(offset, offset + config.maxChunkChars);
      const inputFingerprint = chunkFingerprint({ document, segment, part, content, config });
      chunks.push({
        chunkKey: `${document.documentVersionId}:${segment.id}:${part}`,
        documentVersionId: document.documentVersionId,
        extractionId: document.extractionId,
        segmentId: segment.id,
        ordinal,
        part,
        content,
        charCount: content.length,
        inputFingerprint,
      });
      ordinal += 1;
      part += 1;
    }
  }
  return chunks;
}

function chooseIncompleteReason(input: {
  unsupported: boolean;
  extractionPartial: boolean;
  chunkFailure: boolean;
  budgetLimited: boolean;
}): UnderstandingIncompleteReason | null {
  if (input.unsupported) return "unsupported_document";
  if (input.extractionPartial) return "extraction_partial";
  if (input.chunkFailure) return "chunk_failure";
  if (input.budgetLimited) return "budget_limit";
  return null;
}

export function planUnderstandingInputs(input: {
  documents: UnderstandingDocumentInput[];
  config: UnderstandingPlanningConfig;
  reusableFingerprints?: ReadonlySet<string>;
}): UnderstandingInputPlan {
  assertPositiveInteger(input.config.perDocumentCharBudget, "perDocumentCharBudget");
  assertPositiveInteger(input.config.perOpportunityCharBudget, "perOpportunityCharBudget");
  assertPositiveInteger(input.config.maxChunkChars, "maxChunkChars");

  const documents = [...input.documents].sort((a, b) =>
    a.documentVersionId.localeCompare(b.documentVersionId),
  );
  const reusable = input.reusableFingerprints ?? new Set<string>();
  const chunks: UnderstandingPlannedChunk[] = [];
  const fullyCoveredDocuments = new Set<string>();
  let newCharsSelected = 0;
  let unsupported = false;
  let extractionPartial = false;
  let chunkFailure = false;
  let budgetLimited = false;

  for (const document of documents) {
    if (document.extractionStatus === "unsupported") {
      unsupported = true;
      continue;
    }
    if (document.extractionStatus === "failed") {
      chunkFailure = true;
      continue;
    }
    if (document.extractionStatus !== "extracted") {
      extractionPartial = true;
      continue;
    }
    if (document.truncated) extractionPartial = true;

    const documentChunks = splitDocument(document, input.config);
    let documentSelectedChars = 0;
    let documentFullyCovered = true;

    for (const chunk of documentChunks) {
      if (reusable.has(chunk.inputFingerprint)) {
        chunks.push({ ...chunk, status: "reused", skipReason: null });
        continue;
      }

      const exceedsDocumentBudget =
        documentSelectedChars + chunk.charCount > input.config.perDocumentCharBudget;
      const exceedsOpportunityBudget =
        newCharsSelected + chunk.charCount > input.config.perOpportunityCharBudget;
      if (exceedsDocumentBudget || exceedsOpportunityBudget) {
        chunks.push({ ...chunk, status: "skipped", skipReason: "budget_limit" });
        documentFullyCovered = false;
        budgetLimited = true;
        continue;
      }

      chunks.push({ ...chunk, status: "planned", skipReason: null });
      documentSelectedChars += chunk.charCount;
      newCharsSelected += chunk.charCount;
    }

    if (documentFullyCovered && !document.truncated) {
      fullyCoveredDocuments.add(document.documentVersionId);
    }
  }

  const incompleteReason = chooseIncompleteReason({
    unsupported,
    extractionPartial,
    chunkFailure,
    budgetLimited,
  });
  const coverage: UnderstandingCoverage = {
    documentsTotal: documents.length,
    documentsProcessed: fullyCoveredDocuments.size,
    documentsSkipped: documents.length - fullyCoveredDocuments.size,
    chunksTotal: chunks.length,
    chunksProcessed: chunks.filter((chunk) => chunk.status === "planned").length,
    chunksReused: chunks.filter((chunk) => chunk.status === "reused").length,
    chunksSkipped: chunks.filter((chunk) => chunk.status === "skipped").length,
  };

  return {
    inputFingerprint: hash(
      documents.flatMap((document) => [
        document.documentVersionId,
        document.checksumSha256,
        document.extractorName,
        document.extractorVersion,
      ]),
    ),
    chunks,
    coverage,
    completenessStatus: incompleteReason === null ? "complete" : "partial",
    incompleteReason,
  };
}
