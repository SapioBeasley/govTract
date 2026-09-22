import { createHash } from "node:crypto";

import {
  estimateMaximumCostMicrousd, evaluateModelCallBudget,
} from "./planning";
import {
  estimateProviderRequestTokenBudgets,
} from "./provider-call";
import {
  buildUnderstandingChunkPrompt, UNDERSTANDING_PROMPT_VERSION, UNDERSTANDING_SYSTEM_INSTRUCTION,
  type OpportunityUnderstandingContext,
} from "./prompts";
import type { UnderstandingModelProvider, UnderstandingProviderRequest } from "./provider";
import {
  isSolicitationUnderstandingContent, SOLICITATION_UNDERSTANDING_SCHEMA_VERSION,
  solicitationUnderstandingSectionKeys,
  type SolicitationUnderstandingContent,
} from "./types";

const MAX_CASES = 3;
const MAX_SOURCE_CHARS = 6_000;
const MAX_BUDGET_MICROUSD = 120_000; // $0.12 per explicitly dispatched evaluation.
const OUTPUT_TOKENS_PER_CASE = 4_096;
type FindingSection = Exclude<keyof SolicitationUnderstandingContent, "summary">;
const findingSections = new Set<string>(solicitationUnderstandingSectionKeys.filter((key) => key !== "summary"));

export type UnderstandingEvaluationGold = {
  id: string;
  section: FindingSection;
  sourceQuote: string;
  origin?: "metadata";
  acceptablePhrases: string[];
};

export type UnderstandingEvaluationCase = {
  id: string;
  kind: string;
  provenance: string;
  context: Omit<OpportunityUnderstandingContext, "dueAt"> & { dueAt: string | null };
  documentVersionId: string;
  sourceSegmentId: string;
  sourceText: string;
  required: UnderstandingEvaluationGold[];
};

export type UnderstandingEvaluationCaseResult = {
  id: string;
  kind: string;
  passed: boolean;
  captured: number;
  total: number;
  missing: string[];
  missingCitations: string[];
};

export type UnderstandingEvaluationPlan = {
  cases: UnderstandingEvaluationCase[];
  maxCostMicrousd: number;
};

export type UnderstandingEvaluationReport = {
  passed: boolean;
  promptVersion: string;
  schemaVersion: string;
  fixtureSha256: string;
  model: string;
  modelVersion: string | null;
  pricingProfile: string;
  calls: number;
  estimatedCostMicrousd: number;
  actualCostMicrousd: number;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number };
  cases: UnderstandingEvaluationCaseResult[];
};

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

export function validateUnderstandingEvaluationCase(sample: UnderstandingEvaluationCase) {
  if (!sample || !sample.id?.trim() || !sample.kind?.trim() || !sample.provenance?.trim() ||
    !sample.documentVersionId?.trim() || !sample.sourceSegmentId?.trim() ||
    !sample.sourceText?.trim() || !sample.context?.title?.trim()) {
    throw new Error("Evaluation case is missing an ID, context or pinned source provenance.");
  }
  if (sample.sourceText.length > MAX_SOURCE_CHARS) {
    throw new Error("Evaluation case source text exceeds the 6000-character limit.");
  }
  if (!Array.isArray(sample.required) || !sample.required.length) {
    throw new Error("Evaluation case must have source-backed gold requirements.");
  }
  const ids = new Set<string>();
  for (const gold of sample.required) {
    if (!gold.id?.trim() || ids.has(gold.id)) throw new Error("Duplicate or empty gold requirement ID.");
    ids.add(gold.id);
    if (!findingSections.has(gold.section)) throw new Error("Gold requirement has an invalid section.");
    if (!gold.sourceQuote?.trim() || !gold.acceptablePhrases?.length ||
      gold.acceptablePhrases.some((phrase) => !phrase?.trim())) {
      throw new Error("Gold requirement is missing an anchor or acceptable answer phrase.");
    }
    const target = gold.origin === "metadata"
      ? JSON.stringify(sample.context)
      : sample.sourceText;
    if (!normalized(target).includes(normalized(gold.sourceQuote))) {
      throw new Error("Unanchored required source quote for " + gold.id + ": check the pinned fixture.");
    }
  }
}

function sourceCitationPresent(key: string, segmentId: string) {
  const cited = key.match(/SOURCE\[([^\]]+)\]::/i);
  return Boolean(cited?.[1]?.split(",").map((part) => part.trim()).includes(segmentId));
}

export function evaluateUnderstandingCase(
  sample: UnderstandingEvaluationCase,
  content: SolicitationUnderstandingContent,
): UnderstandingEvaluationCaseResult {
  validateUnderstandingEvaluationCase(sample);
  if (!isSolicitationUnderstandingContent(content)) throw new Error("Invalid structured understanding output.");
  const missing: string[] = [], missingCitations: string[] = [];
  for (const gold of sample.required) {
    const candidates = content[gold.section].filter((finding) =>
      gold.acceptablePhrases.some((phrase) =>
        normalized(finding.text).includes(normalized(phrase))));
    if (!candidates.length) {
      missing.push(gold.id);
    } else if (!candidates.some((finding) => gold.origin === "metadata"
      ? finding.key.startsWith("META::")
      : sourceCitationPresent(finding.key, sample.sourceSegmentId))) {
      missingCitations.push(gold.id);
    }
  }
  return {
    id:sample.id,kind:sample.kind,passed:missing.length === 0 && missingCitations.length === 0,
    captured:sample.required.length - missing.length,total:sample.required.length,
    missing,missingCitations,
  };
}

export function planUnderstandingEvaluation(
  cases: UnderstandingEvaluationCase[],
  limits: { maxCases: number; maxCostMicrousd: number },
): UnderstandingEvaluationPlan {
  if (!Number.isSafeInteger(limits.maxCases) || limits.maxCases < 1 ||
    limits.maxCases > MAX_CASES) throw new Error("Evaluation case count exceeds the hard cap of 3.");
  if (!Number.isSafeInteger(limits.maxCostMicrousd) || limits.maxCostMicrousd < 1 ||
    limits.maxCostMicrousd > MAX_BUDGET_MICROUSD) {
    throw new Error("Evaluation budget must be positive and within the hard $0.12 cap.");
  }
  if (!Array.isArray(cases) || !cases.length || cases.length < limits.maxCases) {
    throw new Error("Not enough pinned evaluation cases were provided.");
  }
  const selected = cases.slice(0,limits.maxCases);
  const ids = new Set<string>();
  for (const sample of selected) {
    validateUnderstandingEvaluationCase(sample);
    if (ids.has(sample.id)) throw new Error("Duplicate evaluation case ID.");
    ids.add(sample.id);
  }
  return {cases:selected,maxCostMicrousd:limits.maxCostMicrousd};
}

function requestFor(sample: UnderstandingEvaluationCase): UnderstandingProviderRequest {
  const context: OpportunityUnderstandingContext = {
    ...sample.context,
    dueAt: sample.context.dueAt ? new Date(sample.context.dueAt) : null,
  };
  return {
    systemInstruction:UNDERSTANDING_SYSTEM_INSTRUCTION,
    prompt:buildUnderstandingChunkPrompt({
      context,
      chunk:{
        documentVersionId:sample.documentVersionId,
        chunkKey:"evaluation:" + sample.id,
        ordinal:0,
        content:"[[SOURCE_SEGMENT:" + sample.sourceSegmentId + "]]\n" + sample.sourceText,
      },
    }),
    maxOutputTokens:OUTPUT_TOKENS_PER_CASE,
  };
}

/**
 * Isolated manual fixture evaluation. Never calls the production generation path
 * or writes an opportunity, understanding, source document or bidder draft.
 * Reserve worst-case model cost *before* each call; no retries are permitted.
 */
export async function executeUnderstandingEvaluation(
  plan: UnderstandingEvaluationPlan,
  provider: UnderstandingModelProvider,
): Promise<UnderstandingEvaluationReport> {
  if (plan.cases.length < 1 || plan.cases.length > MAX_CASES ||
    !Number.isSafeInteger(plan.maxCostMicrousd) || plan.maxCostMicrousd < 1 ||
    plan.maxCostMicrousd > MAX_BUDGET_MICROUSD) throw new Error("Invalid evaluation hard caps.");
  const validated = planUnderstandingEvaluation(plan.cases,{
    maxCases:plan.cases.length,maxCostMicrousd:plan.maxCostMicrousd,
  });
  const profile = {...provider.profile,billingMode:"billable" as const};
  if (profile.inputCostMicrousdPerMillionTokens <= 0 ||
    profile.outputCostMicrousdPerMillionTokens <= 0) {
    throw new Error("A positive, billable pricing profile is required to cap evaluations.");
  }
  let reserved = 0, actual = 0, calls = 0, inputTokens = 0, outputTokens = 0, thinkingTokens = 0;
  const scored: UnderstandingEvaluationCaseResult[] = [];
  let modelVersion = provider.modelVersion;
  for (const sample of validated.cases) {
    const request = requestFor(sample);
    const budget = estimateProviderRequestTokenBudgets(request);
    if (budget.contextInputTokenUpperBound > profile.inputTokenLimit) {
      throw new Error("Evaluation input exceeds the model context limit before model call.");
    }
    const preflight = evaluateModelCallBudget({
      profile,inputTokenBudget:budget.billingInputTokenEstimate,
      outputTokenBudget:request.maxOutputTokens,maxCostMicrousd:plan.maxCostMicrousd,
      spentCostMicrousd:reserved,
    });
    if (!preflight.allowed) throw new Error("Evaluation cost cap or token limit reached before model call: " + preflight.reason);
    reserved += preflight.estimatedCostMicrousd;
    calls++;
    // No automatic retry. A failed paid call has still consumed the bounded call allowance.
    const response = await provider.generate(request);
    modelVersion = response.modelVersion ?? modelVersion;
    const usage = response.usage;
    inputTokens += usage.promptTokenCount;
    outputTokens += usage.candidatesTokenCount;
    thinkingTokens += usage.thoughtsTokenCount;
    const billed = usage.promptTokenCount > 0 && usage.totalTokenCount > 0
      ? estimateMaximumCostMicrousd({
        profile,inputTokenBudget:usage.promptTokenCount,
        outputTokenBudget:usage.candidatesTokenCount + usage.thoughtsTokenCount,
      })
      : preflight.estimatedCostMicrousd; // Missing provider usage must never become a zero-cost call.
    actual += billed;
    if (actual > plan.maxCostMicrousd) throw new Error("Provider usage exceeded evaluation cost cap; stopping without another call.");
    scored.push(evaluateUnderstandingCase(sample,response.content));
  }
  return {
    passed:scored.every((entry) => entry.passed),
    promptVersion:UNDERSTANDING_PROMPT_VERSION,
    schemaVersion:SOLICITATION_UNDERSTANDING_SCHEMA_VERSION,
    fixtureSha256:createHash("sha256").update(JSON.stringify(validated.cases)).digest("hex"),
    model:profile.model,modelVersion,pricingProfile:profile.id,
    calls,estimatedCostMicrousd:reserved,actualCostMicrousd:actual,
    usage:{inputTokens,outputTokens,thinkingTokens},cases:scored,
  };
}
