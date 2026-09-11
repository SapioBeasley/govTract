import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  solicitationUnderstandingChunks,
  solicitationUnderstandingInputs,
  solicitationUnderstandings,
} from "@/lib/db/solicitation-understandings-schema";
import { opportunities } from "@/lib/db/schema";

import type {
  UnderstandingGenerationTrigger,
  UnderstandingIncompleteReason,
  UnderstandingInputPlan,
} from "./planning";
import type { OpportunityUnderstandingContext } from "./prompts";
import type { SolicitationUnderstandingContent } from "./types";
import { isSolicitationUnderstandingContent } from "./types";

export type PersistedUnderstandingSummary = {
  id: string;
  opportunityId: string;
  inputFingerprint: string;
  generationTrigger: UnderstandingGenerationTrigger;
  status: string;
  completenessStatus: "complete" | "partial";
  incompleteReason: UnderstandingIncompleteReason | null;
  isStale: boolean;
  structuredOutput: SolicitationUnderstandingContent | null;
  createdAt: Date;
};

export async function loadOpportunityUnderstandingContext(
  opportunityId: string,
): Promise<OpportunityUnderstandingContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      title: opportunities.title,
      description: opportunities.description,
      agencyName: opportunities.agencyName,
      solicitationNumber: opportunities.solicitationNumber,
      opportunityType: opportunities.opportunityType,
      dueAt: opportunities.dueAt,
      location: opportunities.location,
    })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  return row ?? null;
}

export async function loadLatestSolicitationUnderstanding(
  opportunityId: string,
): Promise<PersistedUnderstandingSummary | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: solicitationUnderstandings.id,
      opportunityId: solicitationUnderstandings.opportunityId,
      inputFingerprint: solicitationUnderstandings.inputFingerprint,
      generationTrigger: solicitationUnderstandings.generationTrigger,
      status: solicitationUnderstandings.status,
      completenessStatus: solicitationUnderstandings.completenessStatus,
      incompleteReason: solicitationUnderstandings.incompleteReason,
      isStale: solicitationUnderstandings.isStale,
      structuredOutput: solicitationUnderstandings.structuredOutput,
      createdAt: solicitationUnderstandings.createdAt,
    })
    .from(solicitationUnderstandings)
    .where(eq(solicitationUnderstandings.opportunityId, opportunityId))
    .orderBy(desc(solicitationUnderstandings.createdAt), desc(solicitationUnderstandings.id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    generationTrigger: row.generationTrigger as UnderstandingGenerationTrigger,
    completenessStatus: row.completenessStatus as "complete" | "partial",
    incompleteReason: row.incompleteReason as UnderstandingIncompleteReason | null,
    structuredOutput:
      row.structuredOutput && isSolicitationUnderstandingContent(row.structuredOutput)
        ? row.structuredOutput
        : null,
  };
}

export async function loadReusableUnderstandingChunkOutputs(opportunityId: string) {
  const db = getDb();
  const rows = await db
    .select({
      inputFingerprint: solicitationUnderstandingChunks.inputFingerprint,
      structuredOutput: solicitationUnderstandingChunks.structuredOutput,
      createdAt: solicitationUnderstandingChunks.createdAt,
      chunkId: solicitationUnderstandingChunks.id,
    })
    .from(solicitationUnderstandingChunks)
    .innerJoin(
      solicitationUnderstandings,
      eq(solicitationUnderstandings.id, solicitationUnderstandingChunks.solicitationUnderstandingId),
    )
    .where(
      and(
        eq(solicitationUnderstandings.opportunityId, opportunityId),
        inArray(solicitationUnderstandingChunks.status, ["processed", "reused"]),
        isNotNull(solicitationUnderstandingChunks.structuredOutput),
      ),
    )
    .orderBy(
      asc(solicitationUnderstandingChunks.inputFingerprint),
      desc(solicitationUnderstandingChunks.createdAt),
      desc(solicitationUnderstandingChunks.id),
    );

  const outputs = new Map<string, SolicitationUnderstandingContent>();
  for (const row of rows) {
    if (outputs.has(row.inputFingerprint)) continue;
    if (isSolicitationUnderstandingContent(row.structuredOutput)) {
      outputs.set(row.inputFingerprint, row.structuredOutput);
    }
  }
  return outputs;
}

export async function createSolicitationUnderstandingRun(input: {
  opportunityId: string;
  plan: UnderstandingInputPlan;
  trigger: UnderstandingGenerationTrigger;
  schemaVersion: string;
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  modelVersion: string | null;
  budgetMicrousd: number;
  pricingProfileVersion: string;
  documentInputs: Array<{ documentVersionId: string; extractionId: string | null }>;
  reusableOutputs: ReadonlyMap<string, SolicitationUnderstandingContent>;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(solicitationUnderstandings)
      .values({
        opportunityId: input.opportunityId,
        inputFingerprint: input.plan.inputFingerprint,
        schemaVersion: input.schemaVersion,
        promptVersion: input.promptVersion,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        modelVersion: input.modelVersion,
        generationTrigger: input.trigger,
        status: "pending",
        completenessStatus: input.plan.completenessStatus,
        incompleteReason: input.plan.incompleteReason,
        coverageMetadata: input.plan.coverage,
        budgetMicrousd: input.budgetMicrousd,
        pricingProfileVersion: input.pricingProfileVersion,
      })
      .returning({ id: solicitationUnderstandings.id });
    if (!created) throw new Error("Failed to create solicitation understanding run");

    if (input.documentInputs.length > 0) {
      await tx.insert(solicitationUnderstandingInputs).values(
        input.documentInputs.map((document) => ({
          solicitationUnderstandingId: created.id,
          opportunityDocumentVersionId: document.documentVersionId,
          documentExtractionId: document.extractionId,
        })),
      );
    }

    if (input.plan.chunks.length > 0) {
      await tx.insert(solicitationUnderstandingChunks).values(
        input.plan.chunks.map((chunk) => ({
          solicitationUnderstandingId: created.id,
          opportunityDocumentVersionId: chunk.documentVersionId,
          documentExtractionId: chunk.extractionId,
          chunkKey: chunk.chunkKey,
          inputFingerprint: chunk.inputFingerprint,
          ordinal: chunk.ordinal,
          status: chunk.status,
          charCount: chunk.charCount,
          structuredOutput:
            chunk.status === "reused" ? input.reusableOutputs.get(chunk.inputFingerprint) ?? null : null,
          skipReason: chunk.skipReason,
          pricingProfileVersion: input.pricingProfileVersion,
        })),
      );
    }

    return created.id;
  });
}

export async function markUnderstandingChunkProcessed(input: {
  understandingId: string;
  chunkKey: string;
  content: SolicitationUnderstandingContent;
  estimatedInputTokenCount: number;
  outputTokenCount: number;
  estimatedCostMicrousd: number;
  actualCostMicrousd: number;
  pricingProfileVersion: string;
}) {
  const db = getDb();
  await db
    .update(solicitationUnderstandingChunks)
    .set({
      status: "processed",
      structuredOutput: input.content,
      estimatedInputTokenCount: input.estimatedInputTokenCount,
      outputTokenCount: input.outputTokenCount,
      estimatedCostMicrousd: input.estimatedCostMicrousd,
      actualCostMicrousd: input.actualCostMicrousd,
      pricingProfileVersion: input.pricingProfileVersion,
      skipReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(solicitationUnderstandingChunks.solicitationUnderstandingId, input.understandingId),
        eq(solicitationUnderstandingChunks.chunkKey, input.chunkKey),
      ),
    );
}

export async function markUnderstandingChunksSkipped(input: {
  understandingId: string;
  chunkKeys: string[];
  reason: string;
}) {
  if (input.chunkKeys.length === 0) return;
  const db = getDb();
  await db
    .update(solicitationUnderstandingChunks)
    .set({ status: "skipped", skipReason: input.reason, updatedAt: new Date() })
    .where(
      and(
        eq(solicitationUnderstandingChunks.solicitationUnderstandingId, input.understandingId),
        inArray(solicitationUnderstandingChunks.chunkKey, input.chunkKeys),
      ),
    );
}

export async function completeSolicitationUnderstandingRun(input: {
  understandingId: string;
  content: SolicitationUnderstandingContent;
  completenessStatus: "complete" | "partial";
  incompleteReason: UnderstandingIncompleteReason | null;
  coverageMetadata: Record<string, unknown>;
  modelVersion: string | null;
  inputTokenCount: number;
  outputTokenCount: number;
  inputCharCount: number;
  outputCharCount: number;
  estimatedCostMicrousd: number;
  actualCostMicrousd: number;
  usageMetadata: Record<string, unknown>;
}) {
  const now = new Date();
  const db = getDb();
  await db
    .update(solicitationUnderstandings)
    .set({
      status: "completed",
      completenessStatus: input.completenessStatus,
      incompleteReason: input.incompleteReason,
      coverageMetadata: input.coverageMetadata,
      modelVersion: input.modelVersion,
      structuredOutput: input.content,
      processingCompletedAt: now,
      generatedAt: now,
      failureCode: null,
      inputTokenCount: input.inputTokenCount,
      outputTokenCount: input.outputTokenCount,
      inputCharCount: input.inputCharCount,
      outputCharCount: input.outputCharCount,
      estimatedCostMicrousd: input.estimatedCostMicrousd,
      actualCostMicrousd: input.actualCostMicrousd,
      usageMetadata: input.usageMetadata,
      updatedAt: now,
    })
    .where(eq(solicitationUnderstandings.id, input.understandingId));
}

export async function failSolicitationUnderstandingRun(input: {
  understandingId: string;
  failureCode: string;
  coverageMetadata: Record<string, unknown>;
  inputTokenCount?: number;
  outputTokenCount?: number;
  estimatedCostMicrousd?: number;
  actualCostMicrousd?: number;
  usageMetadata?: Record<string, unknown>;
}) {
  const now = new Date();
  const db = getDb();
  await db
    .update(solicitationUnderstandings)
    .set({
      status: "failed",
      processingCompletedAt: now,
      failureCode: input.failureCode,
      coverageMetadata: input.coverageMetadata,
      inputTokenCount: input.inputTokenCount ?? null,
      outputTokenCount: input.outputTokenCount ?? null,
      estimatedCostMicrousd: input.estimatedCostMicrousd ?? null,
      actualCostMicrousd: input.actualCostMicrousd ?? null,
      usageMetadata: input.usageMetadata ?? {},
      updatedAt: now,
    })
    .where(eq(solicitationUnderstandings.id, input.understandingId));
}
