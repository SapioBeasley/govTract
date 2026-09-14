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
  maxChunkChars: 200_000,
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
  sourceSegmentIds: string[];
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

function parsePositiveInteger(value: string | undefined, label: string) {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  assertPositiveInteger(parsed, label);
  return parsed;
}

function parseUsdToMicrousd(value: string | undefined, label: string) {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`${label} must be a nonnegative USD amount with at most 6 decimal places`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const microusd = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  assertNonnegativeInteger(microusd, label);
  return microusd;
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

export function loadUnderstandingBudgetPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): UnderstandingBudgetPolicy {
  const overrides: Partial<UnderstandingBudgetPolicy> = {};
  const automaticBudget = parseUsdToMicrousd(
    env.GOVTRACT_AI_AUTOMATIC_BUDGET_USD,
    "GOVTRACT_AI_AUTOMATIC_BUDGET_USD",
  );
  const manualBudget = parseUsdToMicrousd(
    env.GOVTRACT_AI_MANUAL_BUDGET_USD,
    "GOVTRACT_AI_MANUAL_BUDGET_USD",
  );
  const perDocumentCharBudget = parsePositiveInteger(
    env.GOVTRACT_AI_UNDERSTANDING_PER_DOCUMENT_CHAR_BUDGET,
    "GOVTRACT_AI_UNDERSTANDING_PER_DOCUMENT_CHAR_BUDGET",
  );
  const perOpportunityCharBudget = parsePositiveInteger(
    env.GOVTRACT_AI_UNDERSTANDING_PER_OPPORTUNITY_CHAR_BUDGET,
    "GOVTRACT_AI_UNDERSTANDING_PER_OPPORTUNITY_CHAR_BUDGET",
  );
  const maxChunkChars = parsePositiveInteger(
    env.GOVTRACT_AI_UNDERSTANDING_MAX_CHUNK_CHARS,
    "GOVTRACT_AI_UNDERSTANDING_MAX_CHUNK_CHARS",
  );
  const maxOutputTokensPerCall = parsePositiveInteger(
    env.GOVTRACT_AI_UNDERSTANDING_MAX_OUTPUT_TOKENS_PER_CALL,
    "GOVTRACT_AI_UNDERSTANDING_MAX_OUTPUT_TOKENS_PER_CALL",
  );

  if (automaticBudget !== undefined) overrides.automaticMaxCostMicrousd = automaticBudget;
  if (manualBudget !== undefined) overrides.manualMaxCostMicrousd = manualBudget;
  if (perDocumentCharBudget !== undefined) overrides.perDocumentCharBudget = perDocumentCharBudget;
  if (perOpportunityCharBudget !== undefined) overrides.perOpportunityCharBudget = perOpportunityCharBudget;
  if (maxChunkChars !== undefined) overrides.maxChunkChars = maxChunkChars;
  if (maxOutputTokensPerCall !== undefined) overrides.maxOutputTokensPerCall = maxOutputTokensPerCall;
  return resolveUnderstandingBudgetPolicy(overrides);
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
    return { allowed: false, estimatedCostMicrousd, remainingCostMicrousd, reason: "model_input_limit" };
  }
  if (input.outputTokenBudget > input.profile.outputTokenLimit) {
    return { allowed: false, estimatedCostMicrousd, remainingCostMicrousd, reason: "model_output_limit" };
  }
  if (estimatedCostMicrousd > remainingCostMicrousd) {
    return { allowed: false, estimatedCostMicrousd, remainingCostMicrousd, reason: "budget_exceeded" };
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
  if (input.trigger === "automatic_initial" && input.automaticRunExists) return { allowed: false, reason: "automatic_run_already_exists" };
  if (input.trigger === "manual" && !input.explicitManualUserAction) return { allowed: false, reason: "manual_user_action_required" };
  return { allowed: true, reason: null };
}

export function evaluateUnderstandingFreshness(input: {
  previousInputFingerprint: string;
  currentInputFingerprint: string;
}): {
  isStale: boolean;
  shouldAutomaticallyRegenerate: false;
  staleReason: "input_changed" | null;
} {
  const isStale = input.previousInputFingerprint !== input.currentInputFingerprint;
  return {
    isStale,
    shouldAutomaticallyRegenerate: false,
    staleReason: isStale ? "input_changed" : null,
  };
}

function normalizePromptSourceText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type SourcePiece = {
  segment: UnderstandingSegmentInput;
  part: number;
  content: string;
  serialized: string;
  charCount: number;
};

function sourceMarker(segmentId: string) {
  return `[[SOURCE_SEGMENT:${segmentId}]]`;
}

function splitNormalizedSegment(
  segment: UnderstandingSegmentInput,
  maxChunkChars: number,
): SourcePiece[] {
  const normalized = normalizePromptSourceText(segment.content);
  if (!normalized) return [];
  const pieces: SourcePiece[] = [];
  let offset = 0;
  let part = 0;
  while (offset < normalized.length) {
    let end = Math.min(normalized.length, offset + maxChunkChars);
    if (end < normalized.length) {
      const candidate = normalized.slice(offset, end);
      const boundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "));
      if (boundary > maxChunkChars * 0.6) end = offset + boundary;
    }
    const content = normalized.slice(offset, end).trim();
    if (content) {
      pieces.push({
        segment,
        part,
        content,
        serialized: `${sourceMarker(segment.id)}\n${content}`,
        charCount: content.length,
      });
    }
    offset = end;
    while (offset < normalized.length && /\s/.test(normalized[offset]!)) offset += 1;
    part += 1;
  }
  return pieces;
}

function chunkFingerprint(input: {
  document: UnderstandingDocumentInput;
  pieces: SourcePiece[];
  content: string;
  config: UnderstandingPlanningConfig;
}) {
  return hash([
    input.document.checksumSha256,
    input.document.extractorName,
    input.document.extractorVersion,
    ...input.pieces.flatMap((piece) => [
      piece.segment.id,
      piece.segment.contentHashSha256,
      String(piece.part),
    ]),
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
  const pieces = [...document.segments]
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
    .flatMap((segment) => splitNormalizedSegment(segment, config.maxChunkChars));
  const chunks: Omit<UnderstandingPlannedChunk, "status" | "skipReason">[] = [];
  let pendingPieces: SourcePiece[] = [];
  let pendingSourceChars = 0;

  const flush = () => {
    if (pendingPieces.length === 0) return;
    const ordinal = chunks.length;
    const sourceSegmentIds = [...new Set(pendingPieces.map((piece) => piece.segment.id))];
    const content = pendingPieces.map((piece) => piece.serialized).join("\n");
    chunks.push({
      chunkKey: `${document.documentVersionId}:pack:${ordinal}`,
      documentVersionId: document.documentVersionId,
      extractionId: document.extractionId,
      segmentId: sourceSegmentIds[0]!,
      sourceSegmentIds,
      ordinal,
      part: 0,
      content,
      charCount: pendingSourceChars,
      inputFingerprint: chunkFingerprint({ document, pieces: pendingPieces, content, config }),
    });
    pendingPieces = [];
    pendingSourceChars = 0;
  };

  for (const piece of pieces) {
    if (pendingPieces.length > 0 && pendingSourceChars + piece.charCount > config.maxChunkChars) {
      flush();
    }
    pendingPieces.push(piece);
    pendingSourceChars += piece.charCount;
    if (pendingSourceChars >= config.maxChunkChars) flush();
  }
  flush();
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
    inputFingerprint: hash([
      input.config.promptVersion,
      input.config.modelProvider,
      input.config.modelName,
      input.config.modelVersion ?? "",
      ...documents.flatMap((document) => [
        document.documentVersionId,
        document.checksumSha256,
        document.extractorName,
        document.extractorVersion,
      ]),
    ]),
    chunks,
    coverage,
    completenessStatus: incompleteReason === null ? "complete" : "partial",
    incompleteReason,
  };
}
