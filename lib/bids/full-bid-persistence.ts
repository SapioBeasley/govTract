import { and, desc, eq, sql } from "drizzle-orm";

import {
  FULL_BID_PROMPT_VERSION,
  finalizeFullBidDraft,
  makeFullBidDraftPrompt,
  prepareFullBidDraftInput,
} from "@/lib/bids/full-bid";
import {
  BidDraftProviderFailure,
  createGeminiBidDraftProviderFromEnv,
  type BidDraftModelProvider,
} from "@/lib/bids/draft-provider";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { getDefaultCompanyProfile } from "@/lib/company/profile";
import { bidSections } from "@/lib/db/canonical-schema";
import { bidDraftGenerations } from "@/lib/db/bid-draft-generations-schema";
import { getDb } from "@/lib/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FULL_BID_ARTIFACT_TYPE = "full_bid";
export const FULL_BID_TITLE = "Full bid response";

export type FullBidArtifact = {
  id: string;
  content: string | null;
  status: string;
  wordCount: number;
  metadata: Record<string, unknown>;
  updatedAt: Date;
};

function wordCount(content: string) {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

async function selectFullBidArtifact(
  db: Pick<ReturnType<typeof getDb>, "select">,
  workspaceId: string,
): Promise<FullBidArtifact | null> {
  const [row] = await db.select({
    id: bidSections.id,
    content: bidSections.content,
    status: bidSections.status,
    wordCount: bidSections.wordCount,
    metadata: bidSections.metadata,
    updatedAt: bidSections.updatedAt,
  }).from(bidSections).where(and(
    eq(bidSections.bidWorkspaceId, workspaceId),
    sql`${bidSections.metadata}->>'artifactType' = ${FULL_BID_ARTIFACT_TYPE}`,
  )).orderBy(desc(bidSections.updatedAt), desc(bidSections.id)).limit(1);
  return row ?? null;
}

export async function getFullBidArtifact(workspaceId: string) {
  if (!UUID.test(workspaceId)) throw new Error("Bid workspace id is invalid.");
  return selectFullBidArtifact(getDb(), workspaceId);
}

async function ensureFullBidArtifact(workspaceId: string): Promise<FullBidArtifact> {
  if (!UUID.test(workspaceId)) throw new Error("Bid workspace id is invalid.");
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`full-bid:${workspaceId}`}))`);
    const existing = await selectFullBidArtifact(tx, workspaceId);
    if (existing) return existing;
    const [created] = await tx.insert(bidSections).values({
      bidWorkspaceId: workspaceId,
      title: FULL_BID_TITLE,
      instructions: "Primary editable response artifact generated from the current retained solicitation package.",
      content: null,
      status: "draft",
      requirementLinks: {},
      sortOrder: 0,
      wordCount: 0,
      metadata: { artifactType: FULL_BID_ARTIFACT_TYPE },
    }).returning({
      id: bidSections.id,
      content: bidSections.content,
      status: bidSections.status,
      wordCount: bidSections.wordCount,
      metadata: bidSections.metadata,
      updatedAt: bidSections.updatedAt,
    });
    if (!created) throw new Error("Full bid artifact could not be created.");
    return created;
  });
}

export async function saveFullBidDraft(workspaceId: string, content: string) {
  if (!UUID.test(workspaceId) || typeof content !== "string" || content.length > 250_000) {
    throw new Error("Invalid full bid draft.");
  }
  const artifact = await ensureFullBidArtifact(workspaceId);
  const [updated] = await getDb().update(bidSections).set({
    content,
    status: "draft",
    wordCount: wordCount(content),
    metadata: {
      ...artifact.metadata,
      artifactType: FULL_BID_ARTIFACT_TYPE,
      lastEditedBy: "user",
    },
    updatedAt: new Date(),
  }).where(and(
    eq(bidSections.id, artifact.id),
    eq(bidSections.bidWorkspaceId, workspaceId),
  )).returning({
    id: bidSections.id,
    content: bidSections.content,
    status: bidSections.status,
    wordCount: bidSections.wordCount,
    metadata: bidSections.metadata,
    updatedAt: bidSections.updatedAt,
  });
  if (!updated) throw new Error("Full bid draft could not be saved.");
  return updated;
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

/**
 * The only service that invokes the bid-drafting model. Callers must be explicit POST actions.
 * Reads, edits, saves, package checks, renders, refreshes and source jobs never invoke this function.
 */
export async function generateFullBidDraft(input: {
  workspaceId: string;
  requestId: string;
  replace: boolean;
  provider?: BidDraftModelProvider;
  env?: Record<string, string | undefined>;
}) {
  if (!UUID.test(input.workspaceId) || !UUID.test(input.requestId) || typeof input.replace !== "boolean") {
    throw new Error("Invalid manually requested full bid draft input.");
  }
  const artifact = await ensureFullBidArtifact(input.workspaceId);
  const workspace = await getBidWorkspace(input.workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const db = getDb();
  const [duplicate] = await db.select({ id: bidDraftGenerations.id })
    .from(bidDraftGenerations)
    .where(and(
      eq(bidDraftGenerations.bidSectionId, artifact.id),
      eq(bidDraftGenerations.requestId, input.requestId),
    )).limit(1);
  if (duplicate) throw new Error("This manual full bid request was already processed or requested.");
  if (artifact.content?.trim() && !input.replace) {
    throw new Error("Saving over the existing full bid requires explicit replacement confirmation.");
  }

  const company = await getDefaultCompanyProfile();
  const preparation = prepareFullBidDraftInput({
    snapshot: workspace.sourceSnapshot,
    requirements: workspace.sourceRequirements,
    company,
  });
  if (preparation.state === "blocked") throw new Error(preparation.reasons.join(" "));
  const packet = preparation.packet;
  const prompt = makeFullBidDraftPrompt(packet);
  const env = input.env ?? process.env;
  const provider = input.provider ?? createGeminiBidDraftProviderFromEnv(env);
  const inputTokenEstimate = Math.ceil(Buffer.byteLength(prompt, "utf8") / 4) + 1024;
  const outputTokenLimit = Math.min(8192, provider.profile.outputTokenLimit);
  if (inputTokenEstimate > provider.profile.inputTokenLimit || outputTokenLimit <= 0) {
    throw new Error("Full bid draft exceeds the configured AI model input or output limit.");
  }
  const costCeiling = estimatedCost(inputTokenEstimate, outputTokenLimit, provider);
  if (provider.profile.billingMode === "billable" &&
      (budgetMicrousd(env) <= 0 || costCeiling > budgetMicrousd(env))) {
    throw new Error("Manual AI bid drafting budget is disabled or too low for this request.");
  }

  const [created] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${artifact.id}))`);
    const [pending] = await tx.select({ id: bidDraftGenerations.id })
      .from(bidDraftGenerations)
      .where(and(
        eq(bidDraftGenerations.bidSectionId, artifact.id),
        eq(bidDraftGenerations.status, "pending"),
      )).limit(1);
    if (pending) throw new Error("Another manually requested full bid draft is already in progress.");
    return tx.insert(bidDraftGenerations).values({
      bidWorkspaceId: input.workspaceId,
      bidSectionId: artifact.id,
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
      promptVersion: FULL_BID_PROMPT_VERSION,
      estimatedCostMicrousd: costCeiling,
    }).onConflictDoNothing().returning({ id: bidDraftGenerations.id });
  });
  if (!created) throw new Error("This manual full bid request was already processed or requested.");

  let phase: "provider" | "finalize" | "persistence" = "provider";
  try {
    const result = await provider.generate(prompt);
    phase = "finalize";
    const final = finalizeFullBidDraft(packet, result.output);
    const actualCostMicrousd = estimatedCost(
      result.usage.promptTokenCount,
      result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount,
      provider,
    );
    phase = "persistence";
    const currentWorkspace = await getBidWorkspace(input.workspaceId);
    const currentArtifact = await getFullBidArtifact(input.workspaceId);
    const currentPreparation = currentWorkspace ? prepareFullBidDraftInput({
      snapshot: currentWorkspace.sourceSnapshot,
      requirements: currentWorkspace.sourceRequirements,
      company,
    }) : null;
    const canApply = Boolean(
      currentArtifact && currentPreparation?.state === "ready" &&
      currentPreparation.packet.inputFingerprint === packet.inputFingerprint &&
      currentArtifact.content === artifact.content,
    );
    const applied = await db.transaction(async (tx) => {
      const [updated] = canApply ? await tx.update(bidSections).set({
        content: final.content,
        wordCount: wordCount(final.content),
        status: "draft",
        metadata: {
          ...artifact.metadata,
          artifactType: FULL_BID_ARTIFACT_TYPE,
          fullBidGenerationId: created.id,
          fullBidInputFingerprint: packet.inputFingerprint,
          fullBidMissingFacts: final.missingFacts,
          generatedFromSnapshotId: packet.snapshotId,
          generatedFromUnderstandingId: packet.understandingId,
          generatedFromDocumentSetFingerprint: packet.documentSetFingerprint,
        },
        updatedAt: new Date(),
      }).where(and(
        eq(bidSections.id, artifact.id),
        eq(bidSections.bidWorkspaceId, input.workspaceId),
        sql`${bidSections.content} IS NOT DISTINCT FROM ${artifact.content}`,
      )).returning({ id: bidSections.id }) : [];
      await tx.update(bidDraftGenerations).set({
        status: "completed",
        applied: Boolean(updated),
        generatedContent: result.output.content,
        missingFacts: final.missingFacts,
        requirementKeys: final.requirementKeys,
        usageMetadata: result.usage,
        modelVersion: result.modelVersion,
        actualCostMicrousd,
        failureCode: updated ? null : "source_or_bid_changed",
        completedAt: new Date(),
      }).where(eq(bidDraftGenerations.id, created.id));
      return Boolean(updated);
    });
    return {
      state: "completed" as const,
      applied,
      content: final.content,
      generationId: created.id,
    };
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
    }).where(and(
      eq(bidDraftGenerations.id, created.id),
      eq(bidDraftGenerations.status, "pending"),
    ));
    const detail = failureCode === "provider_no_content_max_tokens" ||
      failureCode === "provider_invalid_json_max_tokens"
      ? "Gemini reached the output token limit without a complete full bid."
      : /^provider_http_\d{3}$/.test(failureCode)
        ? `Gemini rejected the full bid request (HTTP ${failureCode.slice(-3)}).`
        : failureCode === "provider_no_content_safety"
          ? "Gemini produced no full bid after its safety checks."
          : failureCode === "provider_invalid_output" || failureCode === "provider_invalid_json" ||
            failureCode === "draft_output_validation_failed"
            ? "Gemini did not return a usable structured full bid."
            : failureCode === "draft_persistence_failure"
              ? "The generated full bid could not be saved."
              : "The full bid provider could not complete the request.";
    throw new Error(`${detail} No draft was saved. Review generation history before another manual request.`);
  }
}
