import { and, desc, eq, sql } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import { BID_DRAFT_PROMPT_VERSION, finalizeBidDraft, prepareBidDraftInput } from "@/lib/bids/draft-input";
import {
  BidDraftProviderFailure,
  createGeminiBidDraftProviderFromEnv,
  makeBidDraftPrompt,
  type BidDraftModelProvider,
} from "@/lib/bids/draft-provider";
import { getDefaultCompanyProfile } from "@/lib/company/profile";
import { bidSections } from "@/lib/db/canonical-schema";
import { bidDraftGenerations } from "@/lib/db/bid-draft-generations-schema";
import { getDb } from "@/lib/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BidDraftGenerationSummary = {
  id: string;
  bidSectionId: string;
  requestId: string;
  status: string;
  applied: boolean;
  sourceSnapshotId: string;
  documentSetFingerprint: string;
  inputFingerprint: string;
  documentVersions: Array<{
    versionId: string; snapshotDocumentId: string; filename: string; checksumSha256: string;
  }>;
  requirementKeys: string[];
  modelProvider: string;
  modelName: string;
  modelVersion: string | null;
  inputTokenCount: number | null;
  outputTokenCount: number | null;
  estimatedCostMicrousd: number | null;
  actualCostMicrousd: number | null;
  createdAt: Date;
  failureCode: string | null;
};

export async function listBidDraftGenerations(workspaceId: string): Promise<BidDraftGenerationSummary[]> {
  const rows = await getDb().select().from(bidDraftGenerations)
    .where(eq(bidDraftGenerations.bidWorkspaceId, workspaceId))
    .orderBy(desc(bidDraftGenerations.createdAt), desc(bidDraftGenerations.id));
  return rows.map((row) => ({
    id: row.id,
    bidSectionId: row.bidSectionId,
    requestId: row.requestId,
    status: row.status,
    applied: row.applied,
    sourceSnapshotId: row.sourceSnapshotId,
    documentSetFingerprint: row.documentSetFingerprint,
    inputFingerprint: row.inputFingerprint,
    documentVersions: row.documentVersions,
    requirementKeys: row.requirementKeys,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    modelVersion: row.modelVersion,
    inputTokenCount: typeof row.usageMetadata.promptTokenCount === "number"
      ? row.usageMetadata.promptTokenCount : null,
    outputTokenCount: typeof row.usageMetadata.candidatesTokenCount === "number"
      ? row.usageMetadata.candidatesTokenCount : null,
    estimatedCostMicrousd: row.estimatedCostMicrousd,
    actualCostMicrousd: row.actualCostMicrousd,
    createdAt: row.createdAt,
    failureCode: row.failureCode,
  }));
}

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

function estimatedCost(inputTokens: number, outputTokens: number, provider: BidDraftModelProvider) {
  if (provider.profile.billingMode === "non_billable") return 0;
  return Math.ceil(
    inputTokens * provider.profile.inputCostMicrousdPerMillionTokens / 1_000_000 +
    outputTokens * provider.profile.outputCostMicrousdPerMillionTokens / 1_000_000,
  );
}

function wordCount(content: string) {
  return content.trim().split(/\s+/).length;
}

/**
 * Only the POST endpoint calls this service, following an explicit user button press.
 * No render, page load, patch, scheduling or ingestion path may invoke the provider.
 * A unique client request ID is claimed before the paid model request.
 */
export async function generateBidSectionDraft(input: {
  workspaceId: string;
  sectionId: string;
  requestId: string;
  replace: boolean;
  provider?: BidDraftModelProvider;
  env?: Record<string, string | undefined>;
}) {
  if (!UUID.test(input.workspaceId) || !UUID.test(input.sectionId) || !UUID.test(input.requestId) ||
    typeof input.replace !== "boolean") {
    throw new Error("Invalid manually requested bid draft input.");
  }
  const workspace = await getBidWorkspace(input.workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const section = workspace.sections.find((row) => row.id === input.sectionId);
  if (!section) throw new Error("Bid response section was not found.");
  const db = getDb();
  const [duplicate] = await db.select({ id: bidDraftGenerations.id })
    .from(bidDraftGenerations)
    .where(and(
      eq(bidDraftGenerations.bidSectionId, input.sectionId),
      eq(bidDraftGenerations.requestId, input.requestId),
    )).limit(1);
  if (duplicate) throw new Error("This manual draft request was already processed or requested.");
  if (section.content?.trim() && !input.replace) {
    throw new Error("Saving over existing draft content requires explicit replacement confirmation.");
  }

  const company = await getDefaultCompanyProfile();
  const preparation = prepareBidDraftInput({
    snapshot: workspace.sourceSnapshot,
    section,
    requirements: workspace.sourceRequirements,
    company,
  });
  if (preparation.state === "blocked") {
    throw new Error(preparation.reasons.join(" "));
  }
  const packet = preparation.packet;
  const prompt = makeBidDraftPrompt(packet);
  const env = input.env ?? process.env;
  const provider = input.provider ?? createGeminiBidDraftProviderFromEnv(env);
  const inputTokenEstimate = Buffer.byteLength(prompt, "utf8") + 4096;
  const outputTokenLimit = Math.min(8192, provider.profile.outputTokenLimit);
  if (inputTokenEstimate > provider.profile.inputTokenLimit || outputTokenLimit <= 0) {
    throw new Error("Bid draft exceeds the configured AI model input or output budget.");
  }
  const costCeiling = estimatedCost(inputTokenEstimate, outputTokenLimit, provider);
  if (provider.profile.billingMode === "billable" &&
    (budgetMicrousd(env) <= 0 || costCeiling > budgetMicrousd(env))) {
    throw new Error("Manual AI bid drafting budget is disabled or too low for this request.");
  }

  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.sectionId}))`);
    const [pending] = await tx.select({ id: bidDraftGenerations.id })
      .from(bidDraftGenerations)
      .where(and(
        eq(bidDraftGenerations.bidSectionId, input.sectionId),
        eq(bidDraftGenerations.status, "pending"),
      )).limit(1);
    if (pending) throw new Error("Another manually requested draft is already in progress for this section.");
    return tx.insert(bidDraftGenerations).values({
      bidWorkspaceId: input.workspaceId,
      bidSectionId: input.sectionId,
      requestId: input.requestId,
      generationTrigger: "manual",
      status: "pending",
      sourceSnapshotId: packet.snapshotId,
      documentSetFingerprint: packet.documentSetFingerprint,
      understandingId: packet.understandingId,
      inputFingerprint: packet.inputFingerprint,
      documentVersions: packet.sourceDocumentVersions,
      requirementKeys: packet.requirementKeys,
      modelProvider: provider.profile.provider,
      modelName: provider.profile.model,
      modelVersion: provider.modelVersion,
      pricingProfileVersion: provider.profile.id,
      promptVersion: BID_DRAFT_PROMPT_VERSION,
      estimatedCostMicrousd: costCeiling,
    }).onConflictDoNothing().returning({ id: bidDraftGenerations.id });
  });
  if (!created) throw new Error("This manual draft request was already processed or requested.");

  let phase: "provider" | "finalize" | "persistence" = "provider";
  try {
    const result = await provider.generate(prompt);
    phase = "finalize";
    const final = finalizeBidDraft(packet, result.output);
    const actualCostMicrousd = estimatedCost(
      result.usage.promptTokenCount,
      result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount,
      provider,
    );
    phase = "persistence";
    const current = await getBidWorkspace(input.workspaceId);
    const currentSection = current?.sections.find((row) => row.id === input.sectionId);
    const currentPrep = current && currentSection ? prepareBidDraftInput({
      snapshot: current.sourceSnapshot,
      section: currentSection,
      requirements: current.sourceRequirements,
      company,
    }) : null;
    const canApply = currentPrep?.state === "ready" &&
      currentPrep.packet.inputFingerprint === packet.inputFingerprint &&
      currentSection?.title === section.title &&
      currentSection?.instructions === section.instructions;
    const output = await db.transaction(async (tx) => {
      const [updated] = canApply ? await tx.update(bidSections).set({
        content: final.content,
        wordCount: wordCount(final.content),
        status: "draft",
        metadata: {
          ...section.metadata,
          aiDraftReview: {
            generationId: created.id,
            sourceSnapshotId: packet.snapshotId,
            documentSetFingerprint: packet.documentSetFingerprint,
            claims: final.inspection.claims,
            modelIssues: final.inspection.modelIssues,
          },
          verifiedVendorFactsFingerprint: null,
        },
        updatedAt: new Date(),
      }).where(and(
        eq(bidSections.id, input.sectionId),
        eq(bidSections.bidWorkspaceId, input.workspaceId),
        sql`${bidSections.content} IS NOT DISTINCT FROM ${section.content}`,
        eq(bidSections.title, section.title),
        sql`${bidSections.instructions} IS NOT DISTINCT FROM ${section.instructions}`,
      )).returning({ id: bidSections.id }) : [];
      await tx.update(bidDraftGenerations).set({
        status: "completed",
        applied: Boolean(updated),
        generatedContent: final.content,
        missingFacts: final.missingFacts,
        requirementKeys: final.requirementKeys,
        usageMetadata: result.usage,
        modelVersion: result.modelVersion,
        actualCostMicrousd,
        failureCode: updated ? null : "source_or_section_changed",
        completedAt: new Date(),
      }).where(eq(bidDraftGenerations.id, created.id));
      return Boolean(updated);
    });
    return { state: "completed" as const, applied: output, content: final.content, generationId: created.id };
  } catch (error) {
    const providerFailure = error instanceof BidDraftProviderFailure ? error : null;
    const failureCode = providerFailure?.failureCode ??
      (phase === "provider" ? "provider_unexpected_failure" :
        phase === "finalize" ? "draft_output_validation_failed" : "draft_persistence_failure");
    await db.update(bidDraftGenerations).set({
      status: "failed",
      failureCode,
      ...(providerFailure?.usage ? { usageMetadata: providerFailure.usage } : {}),
      ...(providerFailure?.modelVersion ? { modelVersion: providerFailure.modelVersion } : {}),
      completedAt: new Date(),
    }).where(and(eq(bidDraftGenerations.id, created.id), eq(bidDraftGenerations.status, "pending")));
    // Show safe classification only. Never return raw Gemini errors, source excerpts,
    // request data, credentials, or unverified billing assertions to the browser.
    const detail = failureCode === "provider_no_content_max_tokens" ||
      failureCode === "provider_invalid_json_max_tokens"
      ? "Gemini reached the output token limit without a complete JSON draft."
      : /^provider_http_\\d{3}$/.test(failureCode)
        ? `Gemini rejected the draft request (HTTP ${failureCode.slice(-3)}).`
        : failureCode === "provider_no_content_safety"
          ? "Gemini produced no draft after its safety checks."
          : failureCode === "provider_invalid_output" ||
            failureCode === "draft_output_validation_failed" ||
            failureCode === "provider_invalid_json"
            ? "Gemini did not return a usable structured draft."
            : failureCode === "draft_persistence_failure"
              ? "The draft could not be saved."
              : "The draft provider could not complete the request.";
    throw new Error(`${detail} No draft was saved. Review the generation record before another manual request.`);
  }
}
