import { createHash } from "node:crypto";
import { and, desc, eq, notInArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { solicitationUnderstandings } from "@/lib/db/solicitation-understandings-schema";
import {
  opportunityDocuments,
  opportunityDocumentVersions,
} from "@/lib/db/schema";

export type DocumentStorageMode = "source" | "object_store";

export interface PersistableDocument {
  sourceDocumentKey: string;
  sourceDocumentId?: string | null;
  name: string;
  url?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  sourceVersionId?: string | null;
  sourceModifiedAt?: Date | null;
  isAmendment?: boolean;
  amendmentLabel?: string | null;
  checksumSha256?: string | null;
  retrievedAt?: Date | null;
  storageMode?: DocumentStorageMode;
  storageUri?: string | null;
  contentPersisted?: boolean;
  sourceMetadata: Record<string, unknown>;
}

export type DocumentVersionChange =
  | "inserted"
  | "retrieved"
  | "metadata_changed"
  | "content_changed"
  | "unchanged";

export interface DocumentVersionDecision {
  change: DocumentVersionChange;
  createVersion: boolean;
  requiresProcessing: boolean;
}

export interface DocumentPersistenceResult {
  documentId: string;
  sourceDocumentKey: string;
  versionNumber: number;
  change: DocumentVersionChange;
  requiresProcessing: boolean;
}

export interface LatestDocumentVersionState {
  fingerprint: string;
  checksumSha256: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function documentMetadataFingerprint(document: PersistableDocument) {
  const stableMetadata = {
    sourceDocumentKey: document.sourceDocumentKey,
    sourceDocumentId: document.sourceDocumentId ?? null,
    name: document.name,
    url: document.url ?? null,
    mimeType: document.mimeType ?? null,
    fileSizeBytes: document.fileSizeBytes ?? null,
    sourceVersionId: document.sourceVersionId ?? null,
    sourceModifiedAt: document.sourceModifiedAt?.toISOString() ?? null,
    isAmendment: document.isAmendment ?? false,
    amendmentLabel: document.amendmentLabel ?? null,
    sourceMetadata: document.sourceMetadata,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalize(stableMetadata)))
    .digest("hex");
}

export function hashDocumentContent(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashDocumentStream(
  chunks: AsyncIterable<Uint8Array | string>,
) {
  const hash = createHash("sha256");
  for await (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".xls", ".xlsx", ".csv", ".txt"];
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
]);

export function isSupportedDocumentType(input: {
  name?: string | null;
  mimeType?: string | null;
}) {
  const mimeType = input.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType && SUPPORTED_MIME_TYPES.has(mimeType)) return true;

  const name = input.name?.trim().toLowerCase();
  return Boolean(name && SUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension)));
}

export function classifyDocumentVersionChange(
  latest: LatestDocumentVersionState | null,
  next: LatestDocumentVersionState,
): DocumentVersionDecision {
  if (!latest) {
    return {
      change: "inserted",
      createVersion: true,
      requiresProcessing: Boolean(next.checksumSha256),
    };
  }

  const sameFingerprint = latest.fingerprint === next.fingerprint;
  const hasNewChecksum = Boolean(next.checksumSha256);
  const hadChecksum = Boolean(latest.checksumSha256);
  const checksumChanged =
    hasNewChecksum && hadChecksum && next.checksumSha256 !== latest.checksumSha256;

  if (sameFingerprint) {
    if (checksumChanged) {
      return { change: "content_changed", createVersion: true, requiresProcessing: true };
    }

    if (hasNewChecksum && !hadChecksum) {
      return { change: "retrieved", createVersion: false, requiresProcessing: true };
    }

    return { change: "unchanged", createVersion: false, requiresProcessing: false };
  }

  if (checksumChanged) {
    return { change: "content_changed", createVersion: true, requiresProcessing: true };
  }

  return {
    change: "metadata_changed",
    createVersion: true,
    requiresProcessing: hasNewChecksum && !hadChecksum,
  };
}

function normalizedStorageMode(document: PersistableDocument): DocumentStorageMode {
  return document.storageMode ?? (document.storageUri ? "object_store" : "source");
}

async function persistOpportunityDocument(input: {
  opportunityId: string;
  document: PersistableDocument;
}): Promise<DocumentPersistenceResult> {
  const db = getDb();
  const now = new Date();
  const { document } = input;

  const [existingDocument] = await db
    .select({ id: opportunityDocuments.id })
    .from(opportunityDocuments)
    .where(
      and(
        eq(opportunityDocuments.opportunityId, input.opportunityId),
        eq(opportunityDocuments.sourceDocumentKey, document.sourceDocumentKey),
      ),
    )
    .limit(1);

  let documentId = existingDocument?.id;
  if (!documentId) {
    const [created] = await db
      .insert(opportunityDocuments)
      .values({
        opportunityId: input.opportunityId,
        sourceDocumentKey: document.sourceDocumentKey,
        sourceDocumentId: document.sourceDocumentId,
        name: document.name,
        url: document.url,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
        sourceMetadata: document.sourceMetadata,
        isActive: true,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .returning({ id: opportunityDocuments.id });

    if (!created) {
      throw new Error(`Failed to insert document ${document.sourceDocumentKey}`);
    }
    documentId = created.id;
  } else {
    await db
      .update(opportunityDocuments)
      .set({
        sourceDocumentId: document.sourceDocumentId,
        name: document.name,
        url: document.url,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
        sourceMetadata: document.sourceMetadata,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(opportunityDocuments.id, documentId));
  }

  const [latest] = await db
    .select({
      id: opportunityDocumentVersions.id,
      versionNumber: opportunityDocumentVersions.versionNumber,
      fingerprint: opportunityDocumentVersions.fingerprint,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
    })
    .from(opportunityDocumentVersions)
    .where(eq(opportunityDocumentVersions.opportunityDocumentId, documentId))
    .orderBy(desc(opportunityDocumentVersions.versionNumber))
    .limit(1);

  const fingerprint = documentMetadataFingerprint(document);
  const nextState: LatestDocumentVersionState = {
    fingerprint,
    checksumSha256: document.checksumSha256 ?? null,
  };
  const decision = classifyDocumentVersionChange(latest ?? null, nextState);
  const storageMode = normalizedStorageMode(document);

  if (latest && !decision.createVersion) {
    if (decision.change === "retrieved" || document.retrievedAt || document.storageUri) {
      await db
        .update(opportunityDocumentVersions)
        .set({
          checksumSha256: document.checksumSha256 ?? latest.checksumSha256,
          retrievedAt: document.retrievedAt ?? undefined,
          storageMode,
          storageUri: document.storageUri ?? undefined,
          contentPersisted: document.contentPersisted ?? Boolean(document.storageUri),
          fileSizeBytes: document.fileSizeBytes ?? undefined,
          mimeType: document.mimeType ?? undefined,
        })
        .where(eq(opportunityDocumentVersions.id, latest.id));
    }

    return {
      documentId,
      sourceDocumentKey: document.sourceDocumentKey,
      versionNumber: latest.versionNumber,
      change: decision.change,
      requiresProcessing: decision.requiresProcessing,
    };
  }

  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  await db.insert(opportunityDocumentVersions).values({
    opportunityDocumentId: documentId,
    versionNumber,
    fingerprint,
    sourceVersionId: document.sourceVersionId,
    sourceModifiedAt: document.sourceModifiedAt,
    isAmendment: document.isAmendment ?? false,
    amendmentLabel: document.amendmentLabel,
    checksumSha256: document.checksumSha256,
    retrievedAt: document.retrievedAt,
    storageMode,
    storageUri: document.storageUri,
    contentPersisted: document.contentPersisted ?? Boolean(document.storageUri),
    name: document.name,
    url: document.url,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    sourceMetadata: document.sourceMetadata,
  });

  return {
    documentId,
    sourceDocumentKey: document.sourceDocumentKey,
    versionNumber,
    change: decision.change,
    requiresProcessing: decision.requiresProcessing,
  };
}

async function markCompletedUnderstandingsStaleForDocumentChange(
  opportunityId: string,
  now: Date,
) {
  const db = getDb();
  await db
    .update(solicitationUnderstandings)
    .set({
      isStale: true,
      staleAt: now,
      staleReason: "source_documents_changed",
      updatedAt: now,
    })
    .where(
      and(
        eq(solicitationUnderstandings.opportunityId, opportunityId),
        eq(solicitationUnderstandings.status, "completed"),
        eq(solicitationUnderstandings.isStale, false),
      ),
    );
}

export async function persistOpportunityDocumentSet(input: {
  opportunityId: string;
  documents: PersistableDocument[];
}) {
  const db = getDb();
  const seenKeys: string[] = [];
  const results: DocumentPersistenceResult[] = [];

  for (const document of input.documents) {
    seenKeys.push(document.sourceDocumentKey);
    results.push(
      await persistOpportunityDocument({
        opportunityId: input.opportunityId,
        document,
      }),
    );
  }

  const now = new Date();
  let deactivatedDocuments: Array<{ id: string }> = [];
  if (seenKeys.length > 0) {
    deactivatedDocuments = await db
      .update(opportunityDocuments)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(opportunityDocuments.opportunityId, input.opportunityId),
          eq(opportunityDocuments.isActive, true),
          notInArray(opportunityDocuments.sourceDocumentKey, seenKeys),
        ),
      )
      .returning({ id: opportunityDocuments.id });
  } else {
    deactivatedDocuments = await db
      .update(opportunityDocuments)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(opportunityDocuments.opportunityId, input.opportunityId),
          eq(opportunityDocuments.isActive, true),
        ),
      )
      .returning({ id: opportunityDocuments.id });
  }

  const sourceDocumentSetChanged =
    deactivatedDocuments.length > 0 || results.some((result) => result.change !== "unchanged");
  if (sourceDocumentSetChanged) {
    await markCompletedUnderstandingsStaleForDocumentChange(input.opportunityId, now);
  }

  return results;
}
