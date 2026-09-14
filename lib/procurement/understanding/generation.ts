import { createHash } from "node:crypto";

import {
  authorizeUnderstandingRun,
  estimateMaximumCostMicrousd,
  evaluateModelCallBudget,
  loadUnderstandingBudgetPolicyFromEnv,
  planUnderstandingInputs,
  type UnderstandingBudgetPolicy,
  type UnderstandingGenerationTrigger,
  type UnderstandingIncompleteReason,
  type UnderstandingInputPlan,
  type UnderstandingPlannedChunk,
} from "./planning";
import {
  completeSolicitationUnderstandingRun,
  createSolicitationUnderstandingRun,
  failSolicitationUnderstandingRun,
  loadLatestSolicitationUnderstanding,
  loadOpportunityUnderstandingContext,
  loadReusableUnderstandingChunkOutputs,
  markUnderstandingChunkProcessed,
  markUnderstandingChunksSkipped,
} from "./generation-persistence";
import { attachSourceSegmentCitations } from "./citations";
import { createGeminiUnderstandingProviderFromEnv } from "./gemini";
import { loadPersistedUnderstandingDocuments } from "./persistence";
import type { UnderstandingModelProvider, UnderstandingProviderRequest } from "./provider";
import {
  callUnderstandingProviderWithRetry,
  estimateProviderRequestTokenBudgets,
} from "./provider-call";
import {
  buildMetadataOnlyUnderstandingPrompt,
  buildUnderstandingChunkPrompt,
  UNDERSTANDING_PROMPT_VERSION,
  UNDERSTANDING_SYSTEM_INSTRUCTION,
  type OpportunityUnderstandingContext,
} from "./prompts";
import {
  SOLICITATION_UNDERSTANDING_SCHEMA_VERSION,
  type SolicitationUnderstandingContent,
  type SolicitationUnderstandingFinding,
} from "./types";

const SUMMARY_CHAR_LIMIT = 6_000;
const PROVIDER_FAILURE_MESSAGE_LIMIT = 500;

type UnderstandingProviderFailureDiagnostic = {
  provider: string;
  model: string;
  chunkKey: string | null;
  category: "http_error" | "invalid_response" | "provider_error";
  httpStatus: number | null;
  message: string;
};

function sanitizeProviderFailureMessage(value: string) {
  return value
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/((?:x-goog-api-key|api[_ -]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROVIDER_FAILURE_MESSAGE_LIMIT);
}

function describeProviderFailure(input: {
  error: unknown;
  provider: string;
  model: string;
  chunkKey: string | null;
}): UnderstandingProviderFailureDiagnostic {
  const rawMessage = input.error instanceof Error ? input.error.message.trim() : "";
  const providerOwnedMessage = input.provider === "gemini" && rawMessage.startsWith("Gemini ");
  const message = providerOwnedMessage
    ? sanitizeProviderFailureMessage(rawMessage)
    : "Provider request failed.";
  const statusMatch = providerOwnedMessage ? rawMessage.match(/\bHTTP\s+(\d{3})\b/i) : null;
  const httpStatus = statusMatch?.[1] ? Number(statusMatch[1]) : null;
  const category = httpStatus
    ? "http_error"
    : providerOwnedMessage &&
        /invalid response|invalid JSON|no structured solicitation understanding|invalid solicitation understanding structure/i.test(
          rawMessage,
        )
      ? "invalid_response"
      : "provider_error";

  return {
    provider: input.provider,
    model: input.model,
    chunkKey: input.chunkKey,
    category,
    httpStatus,
    message,
  };
}

function logProviderFailure(input: {
  understandingId: string;
  opportunityId: string;
  diagnostic: UnderstandingProviderFailureDiagnostic;
}) {
  console.error(
    JSON.stringify({
      event: "solicitation_understanding_provider_failure",
      understandingId: input.understandingId,
      opportunityId: input.opportunityId,
      ...input.diagnostic,
    }),
  );
}

export type UnderstandingGenerationBlockedReason =
  | "automatic_run_already_exists"
  | "manual_user_action_required"
  | "documents_pending"
  | "provider_not_configured"
  | "budget_exceeded"
  | "model_input_limit"
  | "model_output_limit"
  | "no_usable_input";

export type GenerateSolicitationUnderstandingResult =
  | {
      state: "completed";
      understandingId: string;
      content: SolicitationUnderstandingContent;
      completenessStatus: "complete" | "partial";
      incompleteReason: UnderstandingIncompleteReason | null;
    }
  | {
      state: "reused";
      understandingId: string;
      content: SolicitationUnderstandingContent;
      completenessStatus: "complete" | "partial";
      isStale: boolean;
    }
  | {
      state: "blocked";
      reason: UnderstandingGenerationBlockedReason;
    }
  | {
      state: "failed";
      understandingId: string;
      reason: "provider_failure" | "no_usable_model_output";
    };

export type GenerateSolicitationUnderstandingInput = {
  opportunityId: string;
  trigger: UnderstandingGenerationTrigger;
  explicitManualUserAction: boolean;
  provider?: UnderstandingModelProvider;
  budgetPolicy?: UnderstandingBudgetPolicy;
  env?: Record<string, string | undefined>;
};

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

function hashStable(value: unknown) {
  function canonicalize(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(canonicalize);
    if (!current || typeof current !== "object") return current;
    if (current instanceof Date) return current.toISOString();
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function planningPromptCompatibilityVersion(context: OpportunityUnderstandingContext) {
  return `${UNDERSTANDING_PROMPT_VERSION}:${hashStable(context)}`;
}

function maxCostForTrigger(policy: UnderstandingBudgetPolicy, trigger: UnderstandingGenerationTrigger) {
  return trigger === "automatic_initial"
    ? policy.automaticMaxCostMicrousd
    : policy.manualMaxCostMicrousd;
}

function providerForInput(input: GenerateSolicitationUnderstandingInput) {
  if (input.provider) return input.provider;
  try {
    return createGeminiUnderstandingProviderFromEnv(input.env ?? process.env);
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeFindings(
  section: string,
  outputs: SolicitationUnderstandingContent[],
  selector: (content: SolicitationUnderstandingContent) => SolicitationUnderstandingFinding[],
) {
  const findings: SolicitationUnderstandingFinding[] = [];
  const seenText = new Set<string>();
  const usedKeys = new Set<string>();

  for (const output of outputs) {
    for (const finding of selector(output)) {
      const textKey = normalizeText(finding.text);
      if (!textKey || seenText.has(textKey)) continue;
      seenText.add(textKey);

      let key = finding.key.trim() || `${section}.${findings.length + 1}`;
      if (usedKeys.has(key)) {
        let suffix = 2;
        while (usedKeys.has(`${key}.${suffix}`)) suffix += 1;
        key = `${key}.${suffix}`;
      }
      usedKeys.add(key);
      findings.push({ ...finding, key, text: finding.text.trim() });
    }
  }
  return findings;
}

export function mergeSolicitationUnderstandingOutputs(
  outputs: SolicitationUnderstandingContent[],
  context: OpportunityUnderstandingContext,
): SolicitationUnderstandingContent {
  const summaries: string[] = [];
  const seenSummaries = new Set<string>();
  for (const output of outputs) {
    const normalized = normalizeText(output.summary);
    if (!normalized || seenSummaries.has(normalized)) continue;
    seenSummaries.add(normalized);
    summaries.push(output.summary.trim());
  }
  const summary =
    summaries.join(" ").slice(0, SUMMARY_CHAR_LIMIT).trim() ||
    context.description?.trim() ||
    context.title.trim();

  return {
    summary,
    scope: mergeFindings("scope", outputs, (output) => output.scope),
    deliverables: mergeFindings("deliverables", outputs, (output) => output.deliverables),
    workBreakdown: mergeFindings("workBreakdown", outputs, (output) => output.workBreakdown),
    location: mergeFindings("location", outputs, (output) => output.location),
    schedule: mergeFindings("schedule", outputs, (output) => output.schedule),
    quantities: mergeFindings("quantities", outputs, (output) => output.quantities),
    qualifications: mergeFindings("qualifications", outputs, (output) => output.qualifications),
    insuranceBonding: mergeFindings(
      "insuranceBonding",
      outputs,
      (output) => output.insuranceBonding,
    ),
    mandatoryEvents: mergeFindings(
      "mandatoryEvents",
      outputs,
      (output) => output.mandatoryEvents,
    ),
    pricingInstructions: mergeFindings(
      "pricingInstructions",
      outputs,
      (output) => output.pricingInstructions,
    ),
    submissionComponents: mergeFindings(
      "submissionComponents",
      outputs,
      (output) => output.submissionComponents,
    ),
    evaluationCriteria: mergeFindings(
      "evaluationCriteria",
      outputs,
      (output) => output.evaluationCriteria,
    ),
    disqualifiers: mergeFindings("disqualifiers", outputs, (output) => output.disqualifiers),
    questionsAmbiguities: mergeFindings(
      "questionsAmbiguities",
      outputs,
      (output) => output.questionsAmbiguities,
    ),
  };
}

function collectIncompleteReasons(input: {
  plan: UnderstandingInputPlan;
  runtimeReason: UnderstandingIncompleteReason | null;
  hasEmptyExtractedDocument: boolean;
}) {
  const reasons = new Set<UnderstandingIncompleteReason>();
  if (input.plan.incompleteReason) reasons.add(input.plan.incompleteReason);
  if (input.runtimeReason) reasons.add(input.runtimeReason);
  if (input.hasEmptyExtractedDocument) reasons.add("extraction_partial");
  return reasons;
}

function primaryIncompleteReason(reasons: ReadonlySet<UnderstandingIncompleteReason>) {
  const priority: UnderstandingIncompleteReason[] = [
    "unsupported_document",
    "extraction_partial",
    "chunk_failure",
    "budget_limit",
  ];
  return priority.find((reason) => reasons.has(reason)) ?? null;
}

function finalCoverage(input: {
  documents: Awaited<ReturnType<typeof loadPersistedUnderstandingDocuments>>;
  plan: UnderstandingInputPlan;
  processedChunkKeys: ReadonlySet<string>;
  reusedChunkKeys: ReadonlySet<string>;
}) {
  const successful = new Set([...input.processedChunkKeys, ...input.reusedChunkKeys]);
  let documentsProcessed = 0;
  for (const document of input.documents) {
    if (document.extractionStatus !== "extracted" || document.truncated) continue;
    const chunks = input.plan.chunks.filter((chunk) => chunk.documentVersionId === document.documentVersionId);
    if (chunks.length > 0 && chunks.every((chunk) => successful.has(chunk.chunkKey))) {
      documentsProcessed += 1;
    }
  }

  return {
    documentsTotal: input.documents.length,
    documentsProcessed,
    documentsSkipped: input.documents.length - documentsProcessed,
    chunksTotal: input.plan.chunks.length,
    chunksProcessed: input.processedChunkKeys.size,
    chunksReused: input.reusedChunkKeys.size,
    chunksSkipped:
      input.plan.chunks.length - input.processedChunkKeys.size - input.reusedChunkKeys.size,
  };
}

function preflightCall(input: {
  provider: UnderstandingModelProvider;
  request: UnderstandingProviderRequest;
  maxCostMicrousd: number;
  spentCostMicrousd: number;
}) {
  const tokenBudgets = estimateProviderRequestTokenBudgets(input.request);
  const costDecision = evaluateModelCallBudget({
    profile: input.provider.profile,
    inputTokenBudget: tokenBudgets.billingInputTokenEstimate,
    outputTokenBudget: input.request.maxOutputTokens,
    maxCostMicrousd: input.maxCostMicrousd,
    spentCostMicrousd: input.spentCostMicrousd,
  });
  if (tokenBudgets.contextInputTokenUpperBound > input.provider.profile.inputTokenLimit) {
    return {
      inputTokenBudget: tokenBudgets.billingInputTokenEstimate,
      decision: {
        allowed: false as const,
        estimatedCostMicrousd: costDecision.estimatedCostMicrousd,
        remainingCostMicrousd: costDecision.remainingCostMicrousd,
        reason: "model_input_limit" as const,
      },
    };
  }
  return { inputTokenBudget: tokenBudgets.billingInputTokenEstimate, decision: costDecision };
}

function requestForChunk(
  context: OpportunityUnderstandingContext,
  chunk: UnderstandingPlannedChunk,
  maxOutputTokens: number,
): UnderstandingProviderRequest {
  return {
    systemInstruction: UNDERSTANDING_SYSTEM_INSTRUCTION,
    prompt: buildUnderstandingChunkPrompt({ context, chunk }),
    maxOutputTokens,
  };
}

function metadataOnlyRequest(
  context: OpportunityUnderstandingContext,
  maxOutputTokens: number,
): UnderstandingProviderRequest {
  return {
    systemInstruction: UNDERSTANDING_SYSTEM_INSTRUCTION,
    prompt: buildMetadataOnlyUnderstandingPrompt(context),
    maxOutputTokens,
  };
}

export async function generateSolicitationUnderstanding(
  input: GenerateSolicitationUnderstandingInput,
): Promise<GenerateSolicitationUnderstandingResult> {
  const latest = await loadLatestSolicitationUnderstanding(input.opportunityId);
  if (input.trigger === "automatic_initial" && latest) {
    if (latest.status === "completed" && latest.structuredOutput) {
      return {
        state: "reused",
        understandingId: latest.id,
        content: latest.structuredOutput,
        completenessStatus: latest.completenessStatus,
        isStale: latest.isStale,
      };
    }
    return { state: "blocked", reason: "automatic_run_already_exists" };
  }

  const authorization = authorizeUnderstandingRun({
    trigger: input.trigger,
    automaticRunExists: Boolean(latest),
    explicitManualUserAction: input.explicitManualUserAction,
  });
  if (!authorization.allowed) return { state: "blocked", reason: authorization.reason };

  const context = await loadOpportunityUnderstandingContext(input.opportunityId);
  if (!context) return { state: "blocked", reason: "no_usable_input" };

  const documents = await loadPersistedUnderstandingDocuments(input.opportunityId);
  if (
    input.trigger === "automatic_initial" &&
    documents.some((document) => document.extractionStatus === "pending")
  ) {
    return { state: "blocked", reason: "documents_pending" };
  }

  const provider = providerForInput(input);
  if (!provider) return { state: "blocked", reason: "provider_not_configured" };
  const policy = input.budgetPolicy ?? loadUnderstandingBudgetPolicyFromEnv(input.env ?? process.env);
  const maxCostMicrousd = maxCostForTrigger(policy, input.trigger);

  const reusableOutputs = await loadReusableUnderstandingChunkOutputs(input.opportunityId);
  const plan = planUnderstandingInputs({
    documents,
    reusableFingerprints: new Set(reusableOutputs.keys()),
    config: {
      perDocumentCharBudget: policy.perDocumentCharBudget,
      perOpportunityCharBudget: policy.perOpportunityCharBudget,
      maxChunkChars: policy.maxChunkChars,
      promptVersion: planningPromptCompatibilityVersion(context),
      modelProvider: provider.profile.provider,
      modelName: provider.profile.model,
      modelVersion: provider.modelVersion,
    },
  });

  const plannedChunks = plan.chunks.filter((chunk) => chunk.status === "planned");
  const reusedChunks = plan.chunks.filter((chunk) => chunk.status === "reused");
  const hasReusableOutput = reusedChunks.some((chunk) => reusableOutputs.has(chunk.inputFingerprint));
  const firstRequest = plannedChunks[0]
    ? requestForChunk(context, plannedChunks[0], policy.maxOutputTokensPerCall)
    : hasReusableOutput
      ? null
      : metadataOnlyRequest(context, policy.maxOutputTokensPerCall);

  if (firstRequest) {
    const preflight = preflightCall({
      provider,
      request: firstRequest,
      maxCostMicrousd,
      spentCostMicrousd: 0,
    });
    if (!preflight.decision.allowed) {
      return { state: "blocked", reason: preflight.decision.reason };
    }
  }

  let understandingId: string;
  try {
    understandingId = await createSolicitationUnderstandingRun({
      opportunityId: input.opportunityId,
      plan,
      trigger: input.trigger,
      schemaVersion: SOLICITATION_UNDERSTANDING_SCHEMA_VERSION,
      promptVersion: UNDERSTANDING_PROMPT_VERSION,
      modelProvider: provider.profile.provider,
      modelName: provider.profile.model,
      modelVersion: provider.modelVersion,
      budgetMicrousd: maxCostMicrousd,
      pricingProfileVersion: provider.profile.id,
      documentInputs: documents.map((document) => ({
        documentVersionId: document.documentVersionId,
        extractionId: document.extractionId,
      })),
      reusableOutputs,
    });
  } catch (error) {
    if (input.trigger === "automatic_initial" && isUniqueViolation(error)) {
      const existing = await loadLatestSolicitationUnderstanding(input.opportunityId);
      if (existing?.status === "completed" && existing.structuredOutput) {
        return {
          state: "reused",
          understandingId: existing.id,
          content: existing.structuredOutput,
          completenessStatus: existing.completenessStatus,
          isStale: existing.isStale,
        };
      }
      return { state: "blocked", reason: "automatic_run_already_exists" };
    }
    throw error;
  }

  const outputs: SolicitationUnderstandingContent[] = [];
  const processedChunkKeys = new Set<string>();
  const reusedChunkKeys = new Set<string>();
  let runtimeReason: UnderstandingIncompleteReason | null = null;
  let spentCostMicrousd = 0;
  let estimatedCostMicrousd = 0;
  let inputTokenCount = 0;
  let outputTokenCount = 0;
  let thoughtsTokenCount = 0;
  let totalProviderTokenCount = 0;
  let inputCharCount = 0;
  let outputCharCount = 0;
  let providerCallCount = 0;
  const providerFailures: UnderstandingProviderFailureDiagnostic[] = [];
  let resolvedModelVersion = provider.modelVersion;

  for (const chunk of reusedChunks) {
    const output = reusableOutputs.get(chunk.inputFingerprint);
    if (!output) continue;
    reusedChunkKeys.add(chunk.chunkKey);
    outputs.push(output);
  }

  for (let index = 0; index < plannedChunks.length; index += 1) {
    const chunk = plannedChunks[index]!;
    const request = requestForChunk(context, chunk, policy.maxOutputTokensPerCall);
    const preflight = preflightCall({
      provider,
      request,
      maxCostMicrousd,
      spentCostMicrousd,
    });

    if (!preflight.decision.allowed) {
      const remainingKeys = plannedChunks.slice(index).map((candidate) => candidate.chunkKey);
      await markUnderstandingChunksSkipped({
        understandingId,
        chunkKeys: remainingKeys,
        reason: preflight.decision.reason,
      });
      runtimeReason =
        preflight.decision.reason === "budget_exceeded" ? "budget_limit" : "chunk_failure";
      break;
    }

    try {
      const { result } = await callUnderstandingProviderWithRetry({
        provider,
        request,
        chunkKey: chunk.chunkKey,
        onAttempt: () => {
          providerCallCount += 1;
        },
        onFailure: ({ error }) => {
          const diagnostic = describeProviderFailure({
            error,
            provider: provider.profile.provider,
            model: provider.profile.model,
            chunkKey: chunk.chunkKey,
          });
          providerFailures.push(diagnostic);
          logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
        },
      });
      const citedContent = attachSourceSegmentCitations(
        result.content,
        new Set(chunk.sourceSegmentIds),
      );
      resolvedModelVersion = result.modelVersion ?? resolvedModelVersion;
      const paidOutputTokens = result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount;
      const actualCostMicrousd = estimateMaximumCostMicrousd({
        profile: provider.profile,
        inputTokenBudget: result.usage.promptTokenCount,
        outputTokenBudget: paidOutputTokens,
      });

      spentCostMicrousd += actualCostMicrousd;
      estimatedCostMicrousd += preflight.decision.estimatedCostMicrousd;
      inputTokenCount += result.usage.promptTokenCount;
      outputTokenCount += result.usage.candidatesTokenCount;
      thoughtsTokenCount += result.usage.thoughtsTokenCount;
      totalProviderTokenCount += result.usage.totalTokenCount;
      inputCharCount += request.systemInstruction.length + request.prompt.length;
      outputCharCount += JSON.stringify(citedContent).length;
      processedChunkKeys.add(chunk.chunkKey);
      outputs.push(citedContent);

      await markUnderstandingChunkProcessed({
        understandingId,
        chunkKey: chunk.chunkKey,
        content: citedContent,
        estimatedInputTokenCount: preflight.inputTokenBudget,
        outputTokenCount: paidOutputTokens,
        estimatedCostMicrousd: preflight.decision.estimatedCostMicrousd,
        actualCostMicrousd,
        pricingProfileVersion: provider.profile.id,
      });
    } catch (error) {
      const diagnostic = describeProviderFailure({
        error,
        provider: provider.profile.provider,
        model: provider.profile.model,
        chunkKey: chunk.chunkKey,
      });
      providerFailures.push(diagnostic);
      logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
      const remainingKeys = plannedChunks.slice(index).map((candidate) => candidate.chunkKey);
      await markUnderstandingChunksSkipped({
        understandingId,
        chunkKeys: remainingKeys,
        reason: "provider_failure",
      });
      runtimeReason = "chunk_failure";
      break;
    }
  }

  if (plannedChunks.length === 0 && !hasReusableOutput) {
    const request = metadataOnlyRequest(context, policy.maxOutputTokensPerCall);
    const preflight = preflightCall({
      provider,
      request,
      maxCostMicrousd,
      spentCostMicrousd,
    });
    if (!preflight.decision.allowed) {
      await failSolicitationUnderstandingRun({
        understandingId,
        failureCode: preflight.decision.reason,
        coverageMetadata: plan.coverage,
      });
      return { state: "failed", understandingId, reason: "no_usable_model_output" };
    }

    try {
      const { result } = await callUnderstandingProviderWithRetry({
        provider,
        request,
        chunkKey: null,
        onAttempt: () => {
          providerCallCount += 1;
        },
        onFailure: ({ error }) => {
          const diagnostic = describeProviderFailure({
            error,
            provider: provider.profile.provider,
            model: provider.profile.model,
            chunkKey: null,
          });
          providerFailures.push(diagnostic);
          logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
        },
      });
      const citedContent = attachSourceSegmentCitations(result.content, new Set());
      resolvedModelVersion = result.modelVersion ?? resolvedModelVersion;
      const paidOutputTokens = result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount;
      const actualCostMicrousd = estimateMaximumCostMicrousd({
        profile: provider.profile,
        inputTokenBudget: result.usage.promptTokenCount,
        outputTokenBudget: paidOutputTokens,
      });
      spentCostMicrousd += actualCostMicrousd;
      estimatedCostMicrousd += preflight.decision.estimatedCostMicrousd;
      inputTokenCount += result.usage.promptTokenCount;
      outputTokenCount += result.usage.candidatesTokenCount;
      thoughtsTokenCount += result.usage.thoughtsTokenCount;
      totalProviderTokenCount += result.usage.totalTokenCount;
      inputCharCount += request.systemInstruction.length + request.prompt.length;
      outputCharCount += JSON.stringify(citedContent).length;
      outputs.push(citedContent);
    } catch (error) {
      const diagnostic = describeProviderFailure({
        error,
        provider: provider.profile.provider,
        model: provider.profile.model,
        chunkKey: null,
      });
      providerFailures.push(diagnostic);
      logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
      await failSolicitationUnderstandingRun({
        understandingId,
        failureCode: "provider_failure",
        coverageMetadata: plan.coverage,
        usageMetadata: {
          providerCallCount,
          thoughtsTokenCount,
          totalProviderTokenCount,
          providerFailures,
        },
      });
      return { state: "failed", understandingId, reason: "provider_failure" };
    }
  }

  if (outputs.length === 0) {
    const coverage = finalCoverage({ documents, plan, processedChunkKeys, reusedChunkKeys });
    await failSolicitationUnderstandingRun({
      understandingId,
      failureCode: "no_usable_model_output",
      coverageMetadata: coverage,
      inputTokenCount,
      outputTokenCount,
      estimatedCostMicrousd,
      actualCostMicrousd: spentCostMicrousd,
      usageMetadata: {
        providerCallCount,
        thoughtsTokenCount,
        totalProviderTokenCount,
        providerFailures,
      },
    });
    return { state: "failed", understandingId, reason: "no_usable_model_output" };
  }

  const coverage = finalCoverage({ documents, plan, processedChunkKeys, reusedChunkKeys });
  const reasons = collectIncompleteReasons({
    plan,
    runtimeReason,
    hasEmptyExtractedDocument: documents.some(
      (document) => document.extractionStatus === "extracted" && document.segments.length === 0,
    ),
  });
  const incompleteReason = primaryIncompleteReason(reasons);
  const completenessStatus = incompleteReason ? "partial" : "complete";
  const content = mergeSolicitationUnderstandingOutputs(outputs, context);

  await completeSolicitationUnderstandingRun({
    understandingId,
    content,
    completenessStatus,
    incompleteReason,
    coverageMetadata: {
      ...coverage,
      incompleteReasons: [...reasons],
    },
    modelVersion: resolvedModelVersion,
    inputTokenCount,
    outputTokenCount,
    inputCharCount,
    outputCharCount,
    estimatedCostMicrousd,
    actualCostMicrousd: spentCostMicrousd,
    usageMetadata: {
      providerCallCount,
      thoughtsTokenCount,
      totalProviderTokenCount,
      reusedChunkCount: reusedChunkKeys.size,
      providerFailures,
    },
  });

  return {
    state: "completed",
    understandingId,
    content,
    completenessStatus,
    incompleteReason,
  };
}
