import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  applyBidderAnswerReplacements,
  BidderAnswerValidationError,
  extractNeedsInputPrompts,
  normalizeBidderInputAnswers,
  type BidderInputAnswer,
} from "@/lib/bids/bidder-inputs";
import { prepareBidDraftInput } from "@/lib/bids/draft-input";
import {
  BidDraftProviderFailure,
  createGeminiBidAnswerProviderFromEnv,
  makeBidAnswerRevisionPrompt,
  type BidAnswerModelProvider,
} from "@/lib/bids/draft-provider";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { getDefaultCompanyProfile } from "@/lib/company/profile";
import { bidSections } from "@/lib/db/canonical-schema";
import { bidDraftGenerations } from "@/lib/db/bid-draft-generations-schema";
import { getDb } from "@/lib/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BIDDER_ANSWER_PROMPT_VERSION = "bidder-answers-v2";

function budgetMicrousd(env: Record<string, string | undefined>) {
  const raw = env.GOVTRACT_AI_BID_DRAFT_BUDGET_USD?.trim() || "0";
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error("GOVTRACT_AI_BID_DRAFT_BUDGET_USD must be a nonnegative USD amount.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const budget = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(budget)) throw new Error("AI bid draft budget is out of range.");
  return budget;
}

function estimatedCost(inputTokens: number, outputTokens: number, provider: BidAnswerModelProvider) {
  if (provider.profile.billingMode === "non_billable") return 0;
  return Math.ceil(
    inputTokens * provider.profile.inputCostMicrousdPerMillionTokens / 1_000_000 +
    outputTokens * provider.profile.outputCostMicrousdPerMillionTokens / 1_000_000,
  );
}

function wordCount(content: string) {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Explicit manual AI action that incorporates only user-supplied bidder answers into
 * existing Needs-input placeholders. It never treats bidder answers as source evidence
 * and never rewrites unrelated saved draft text.
 */
export async function applyBidderAnswersToFullBid(input: {
  workspaceId: string;
  requestId: string;
  answers: BidderInputAnswer[];
  provider?: BidAnswerModelProvider;
  env?: Record<string, string | undefined>;
}) {
  if (!UUID.test(input.workspaceId) || !UUID.test(input.requestId) || !Array.isArray(input.answers)) {
    throw new Error("Invalid manually requested bidder-answer input.");
  }

  const workspace = await getBidWorkspace(input.workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const section = workspace.sections.find((row) => row.metadata.fullBid === true);
  if (!section?.content?.trim()) {
    throw new Error("Generate and save the full bid before updating Needs your input answers.");
  }

  const answers = normalizeBidderInputAnswers(section.content, input.answers);
  if (!answers.length) throw new Error("Enter at least one answer before updating the bid.");

  const company = await getDefaultCompanyProfile();
  const preparation = prepareBidDraftInput({
    snapshot: workspace.sourceSnapshot,
    section,
    requirements: workspace.sourceRequirements,
    company,
  });
  if (preparation.state === "blocked") throw new Error(preparation.reasons.join(" "));
  const packet = preparation.packet;
  const prompt = makeBidAnswerRevisionPrompt({
    packet,
    currentContent: section.content,
    answers,
  });

  const env = input.env ?? process.env;
  const provider = input.provider ?? createGeminiBidAnswerProviderFromEnv(env);
  const inputTokenEstimate = Buffer.byteLength(prompt, "utf8") + 2048;
  const outputTokenLimit = Math.min(4096, provider.profile.outputTokenLimit);
  if (inputTokenEstimate > provider.profile.inputTokenLimit || outputTokenLimit <= 0) {
    throw new Error("Bid answer update exceeds the configured AI model input or output budget.");
  }
  const costCeiling = estimatedCost(inputTokenEstimate, outputTokenLimit, provider);
  if (provider.profile.billingMode === "billable" &&
      (budgetMicrousd(env) <= 0 || costCeiling > budgetMicrousd(env))) {
    throw new Error("Manual AI bid drafting budget is disabled or too low for this request.");
  }

  const inputFingerprint = createHash("sha256").update(JSON.stringify({
    promptVersion: BIDDER_ANSWER_PROMPT_VERSION,
    packetFingerprint: packet.inputFingerprint,
    content: section.content,
    answers,
  })).digest("hex");
  const db = getDb();
  const [duplicate] = await db.select({ id: bidDraftGenerations.id })
    .from(bidDraftGenerations)
    .where(and(
      eq(bidDraftGenerations.bidSectionId, section.id),
      eq(bidDraftGenerations.requestId, input.requestId),
    )).limit(1);
  if (duplicate) throw new Error("This manual bidder-answer request was already processed or requested.");

  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${section.id}))`);
    const [pending] = await tx.select({ id: bidDraftGenerations.id })
      .from(bidDraftGenerations)
      .where(and(
        eq(bidDraftGenerations.bidSectionId, section.id),
        eq(bidDraftGenerations.status, "pending"),
      )).limit(1);
    if (pending) throw new Error("Another manually requested draft update is already in progress.");
    return tx.insert(bidDraftGenerations).values({
      bidWorkspaceId: input.workspaceId,
      bidSectionId: section.id,
      requestId: input.requestId,
      generationTrigger: "manual",
      status: "pending",
      sourceSnapshotId: packet.snapshotId,
      documentSetFingerprint: packet.documentSetFingerprint,
      understandingId: packet.understandingId,
      inputFingerprint,
      documentVersions: packet.sourceDocumentVersions,
      requirementKeys: packet.requirementKeys,
      modelProvider: provider.profile.provider,
      modelName: provider.profile.model,
      modelVersion: provider.modelVersion,
      pricingProfileVersion: provider.profile.id,
      promptVersion: BIDDER_ANSWER_PROMPT_VERSION,
      estimatedCostMicrousd: costCeiling,
    }).onConflictDoNothing().returning({ id: bidDraftGenerations.id });
  });
  if (!created) throw new Error("This manual bidder-answer request was already processed or requested.");

  let phase: "provider" | "validation" | "persistence" = "provider";
  let result: Awaited<ReturnType<BidAnswerModelProvider["generate"]>> | null = null;
  try {
    const generated = await provider.generate(prompt);
    result = generated;
    phase = "validation";
    const revised = applyBidderAnswerReplacements({
      content: section.content,
      answers,
      replacements: generated.output.replacements,
      sourceEvidence: packet.sourceEvidence,
    });
    const remainingQuestions = extractNeedsInputPrompts(revised);
    const actualCostMicrousd = estimatedCost(
      generated.usage.promptTokenCount,
      generated.usage.candidatesTokenCount + generated.usage.thoughtsTokenCount,
      provider,
    );

    phase = "persistence";
    const current = await getBidWorkspace(input.workspaceId);
    const currentSection = current?.sections.find((row) => row.id === section.id);
    const currentPrep = current && currentSection ? prepareBidDraftInput({
      snapshot: current.sourceSnapshot,
      section: currentSection,
      requirements: current.sourceRequirements,
      company,
    }) : null;
    const canApply = currentPrep?.state === "ready" &&
      currentPrep.packet.inputFingerprint === packet.inputFingerprint &&
      currentSection?.content === section.content &&
      currentSection?.title === section.title &&
      currentSection?.instructions === section.instructions;

    const applied = await db.transaction(async (tx) => {
      const [updated] = canApply ? await tx.update(bidSections).set({
        content: revised,
        wordCount: wordCount(revised),
        status: "draft",
        metadata: {
          ...section.metadata,
          aiDraftReview: {
            generationId: created.id,
            sourceSnapshotId: packet.snapshotId,
            documentSetFingerprint: packet.documentSetFingerprint,
            bidderInputQuestions: answers.map((answer) => answer.question),
            claims: [],
            modelIssues: [],
          },
          verifiedVendorFactsFingerprint: null,
        },
        updatedAt: new Date(),
      }).where(and(
        eq(bidSections.id, section.id),
        eq(bidSections.bidWorkspaceId, input.workspaceId),
        sql`${bidSections.content} IS NOT DISTINCT FROM ${section.content}`,
        eq(bidSections.title, section.title),
        sql`${bidSections.instructions} IS NOT DISTINCT FROM ${section.instructions}`,
      )).returning({ id: bidSections.id }) : [];

      await tx.update(bidDraftGenerations).set({
        status: "completed",
        applied: Boolean(updated),
        generatedContent: JSON.stringify(generated.output),
        missingFacts: remainingQuestions,
        requirementKeys: packet.requirementKeys,
        usageMetadata: generated.usage,
        modelVersion: generated.modelVersion,
        actualCostMicrousd,
        failureCode: updated ? null : "source_or_section_changed",
        completedAt: new Date(),
      }).where(eq(bidDraftGenerations.id, created.id));
      return Boolean(updated);
    });

    return {
      state: "completed" as const,
      applied,
      content: revised,
      generationId: created.id,
      remainingQuestions,
    };
  } catch (error) {
    const providerFailure = error instanceof BidDraftProviderFailure ? error : null;
    const validationFailure = error instanceof BidderAnswerValidationError ? error : null;
    const failureCode = providerFailure?.failureCode ??
      validationFailure?.failureCode ??
      (phase === "provider" ? "provider_unexpected_failure" :
        phase === "validation" ? "bidder_answer_invalid_output" : "draft_persistence_failure");
    const completedUsage = result?.usage ?? providerFailure?.usage ?? null;
    const completedModelVersion = result?.modelVersion ?? providerFailure?.modelVersion ?? null;
    const actualCostMicrousd = result ? estimatedCost(
      result.usage.promptTokenCount,
      result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount,
      provider,
    ) : null;
    await db.update(bidDraftGenerations).set({
      status: "failed",
      failureCode,
      ...(result ? { generatedContent: JSON.stringify(result.output) } : {}),
      ...(completedUsage ? { usageMetadata: completedUsage } : {}),
      ...(completedModelVersion ? { modelVersion: completedModelVersion } : {}),
      ...(actualCostMicrousd !== null ? { actualCostMicrousd } : {}),
      completedAt: new Date(),
    }).where(and(eq(bidDraftGenerations.id, created.id), eq(bidDraftGenerations.status, "pending")));

    const bidderAnswerValidationCodes = [
      "bidder_answer_count_mismatch",
      "bidder_answer_invalid_output",
      "bidder_answer_question_mismatch",
      "bidder_answer_invalid_text",
      "bidder_answer_placeholder",
      "bidder_answer_unsupported_fact",
      "bidder_answer_missing_fact",
      "bidder_answer_prompt_not_found",
    ];
    const detail = failureCode === "provider_no_content_max_tokens" ||
      failureCode === "provider_invalid_json_max_tokens"
      ? "Gemini reached the output token limit without a complete answer update."
      : /^provider_http_\d{3}$/.test(failureCode)
        ? `Gemini rejected the bidder-answer request (HTTP ${failureCode.slice(-3)}).`
        : failureCode === "provider_no_content_safety"
          ? "Gemini produced no bidder-answer update after its safety checks."
          : failureCode === "provider_invalid_output" ||
            failureCode === "provider_invalid_json" ||
            bidderAnswerValidationCodes.includes(failureCode)
            ? "Gemini did not return a safe bidder-answer update."
            : failureCode === "draft_persistence_failure"
              ? "The bidder-answer update could not be saved."
              : "The bidder-answer provider could not complete the request.";
    throw new Error(`${detail} No saved bid was overwritten. Review the generation record before another manual request.`);
  }
}
