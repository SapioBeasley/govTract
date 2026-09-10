import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  documentExtractionSegments,
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";

import {
  buildDocumentExtractionIdentity,
  type PreparedExtraction,
} from "./extractions";

export type PersistExtractionInput = {
  documentVersionIds: string[];
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
  sourceMimeType?: string | null;
  sourceByteCount?: number | null;
  metadata?: Record<string, unknown>;
  prepared: PreparedExtraction;
};

export type PersistExtractionResult = {
  extractionId: string;
  status: "extracted" | "truncated";
  reused: boolean;
};

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function safeFailureCode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_:-]{0,99}$/.test(normalized)) {
    throw new Error("Extraction failure code must be a safe machine-readable identifier");
  }
  return normalized;
}

async function attachVersions(
  db: ReturnType<typeof getDb>,
  extractionId: string,
  documentVersionIds: string[],
) {
  const ids = uniqueIds(documentVersionIds);
  if (ids.length === 0) return;

  await db
    .insert(opportunityDocumentVersionExtractions)
    .values(
      ids.map((documentVersionId) => ({
        opportunityDocumentVersionId: documentVersionId,
        documentExtractionId: extractionId,
      })),
    )
    .onConflictDoNothing();
}

async function getOrCreateExtraction(input: {
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
  sourceMimeType?: string | null;
  sourceByteCount?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const identity = buildDocumentExtractionIdentity(input);
  const now = new Date();

  const [created] = await db
    .insert(documentExtractions)
    .values({
      ...identity,
      status: "pending",
      sourceMimeType: input.sourceMimeType ?? null,
      sourceByteCount: input.sourceByteCount ?? null,
      metadata: input.metadata ?? {},
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        documentExtractions.checksumSha256,
        documentExtractions.extractorName,
        documentExtractions.extractorVersion,
      ],
    })
    .returning({
      id: documentExtractions.id,
      status: documentExtractions.status,
    });

  if (created) return created;

  const [existing] = await db
    .select({
      id: documentExtractions.id,
      status: documentExtractions.status,
    })
    .from(documentExtractions)
    .where(
      and(
        eq(documentExtractions.checksumSha256, identity.checksumSha256),
        eq(documentExtractions.extractorName, identity.extractorName),
        eq(documentExtractions.extractorVersion, identity.extractorVersion),
      ),
    )
    .limit(1);

  if (!existing) throw new Error("Failed to resolve canonical document extraction");
  return existing;
}

export async function reuseDocumentExtractionIfAvailable(input: {
  documentVersionIds: string[];
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
}) {
  const db = getDb();
  const identity = buildDocumentExtractionIdentity(input);
  const [existing] = await db
    .select({
      id: documentExtractions.id,
      status: documentExtractions.status,
    })
    .from(documentExtractions)
    .where(
      and(
        eq(documentExtractions.checksumSha256, identity.checksumSha256),
        eq(documentExtractions.extractorName, identity.extractorName),
        eq(documentExtractions.extractorVersion, identity.extractorVersion),
      ),
    )
    .limit(1);

  if (!existing || !["extracted", "truncated"].includes(existing.status)) return null;
  await attachVersions(db, existing.id, input.documentVersionIds);

  return {
    extractionId: existing.id,
    status: existing.status as "extracted" | "truncated",
    reused: true as const,
  };
}

export async function persistDocumentExtraction(
  input: PersistExtractionInput,
): Promise<PersistExtractionResult> {
  const db = getDb();
  const row = await getOrCreateExtraction(input);

  if (["extracted", "truncated"].includes(row.status)) {
    await attachVersions(db, row.id, input.documentVersionIds);
    return {
      extractionId: row.id,
      status: row.status as "extracted" | "truncated",
      reused: true,
    };
  }

  const now = new Date();
  const status = input.prepared.truncated ? "truncated" : "extracted";

  await db.transaction(async (tx) => {
    await tx
      .delete(documentExtractionSegments)
      .where(eq(documentExtractionSegments.documentExtractionId, row.id));

    if (input.prepared.segments.length > 0) {
      await tx.insert(documentExtractionSegments).values(
        input.prepared.segments.map((segment) => ({
          documentExtractionId: row.id,
          ordinal: segment.ordinal,
          segmentType: segment.segmentType,
          locator: segment.locator,
          content: segment.content,
          contentHashSha256: segment.contentHashSha256,
          charCount: segment.charCount,
          byteCount: segment.byteCount,
        })),
      );
    }

    await tx
      .update(documentExtractions)
      .set({
        status,
        sourceMimeType: input.sourceMimeType ?? null,
        sourceByteCount: input.sourceByteCount ?? null,
        extractedCharCount: input.prepared.extractedCharCount,
        extractedByteCount: input.prepared.extractedByteCount,
        segmentCount: input.prepared.segments.length,
        truncated: input.prepared.truncated,
        failureCode: null,
        metadata: {
          ...(input.metadata ?? {}),
          ...(input.prepared.truncationReason
            ? { truncationReason: input.prepared.truncationReason }
            : {}),
        },
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(documentExtractions.id, row.id));

    const ids = uniqueIds(input.documentVersionIds);
    if (ids.length > 0) {
      await tx
        .insert(opportunityDocumentVersionExtractions)
        .values(
          ids.map((documentVersionId) => ({
            opportunityDocumentVersionId: documentVersionId,
            documentExtractionId: row.id,
          })),
        )
        .onConflictDoNothing();
    }
  });

  return { extractionId: row.id, status, reused: false };
}

export async function persistDocumentExtractionFailure(input: {
  documentVersionIds: string[];
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
  sourceMimeType?: string | null;
  sourceByteCount?: number | null;
  failureCode: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const row = await getOrCreateExtraction(input);

  if (["extracted", "truncated"].includes(row.status)) {
    await attachVersions(db, row.id, input.documentVersionIds);
    return { extractionId: row.id, status: row.status, reused: true as const };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .delete(documentExtractionSegments)
      .where(eq(documentExtractionSegments.documentExtractionId, row.id));

    await tx
      .update(documentExtractions)
      .set({
        status: "failed",
        sourceMimeType: input.sourceMimeType ?? null,
        sourceByteCount: input.sourceByteCount ?? null,
        extractedCharCount: 0,
        extractedByteCount: 0,
        segmentCount: 0,
        truncated: false,
        failureCode: safeFailureCode(input.failureCode),
        metadata: input.metadata ?? {},
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(documentExtractions.id, row.id));

    const ids = uniqueIds(input.documentVersionIds);
    if (ids.length > 0) {
      await tx
        .insert(opportunityDocumentVersionExtractions)
        .values(
          ids.map((documentVersionId) => ({
            opportunityDocumentVersionId: documentVersionId,
            documentExtractionId: row.id,
          })),
        )
        .onConflictDoNothing();
    }
  });

  return { extractionId: row.id, status: "failed" as const, reused: false as const };
}
