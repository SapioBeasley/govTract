import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  pursuitDocumentSnapshots,
  pursuitSnapshotDocuments,
  sourceBinaryArtifacts,
} from "@/lib/db/pursuit-snapshots-schema";
import { savedOpportunities } from "@/lib/db/saved-opportunities-schema";
import {
  opportunities,
  opportunityDocuments,
  opportunityDocumentVersions,
} from "@/lib/db/schema";

export type SnapshotRetrievalFailureCode =
  | "auth_blocked"
  | "missing"
  | "source_restricted"
  | "network"
  | "http"
  | "size"
  | "checksum_mismatch"
  | "storage_unavailable"
  | "unknown";

export class SnapshotRetrievalError extends Error {
  constructor(
    readonly code: SnapshotRetrievalFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotRetrievalError";
  }
}

export interface PursuitDocumentRetriever {
  retrieveToFile(input: {
    opportunityId: string;
    opportunityDocumentId: string;
    opportunityDocumentVersionId: string;
    source: string;
    sourceDocumentKey: string;
    filename: string;
    mimeType: string | null;
    expectedChecksumSha256: string | null;
    destinationPath: string;
    maxBytes: number;
  }): Promise<{
    retrievedAt: Date;
    mimeType?: string | null;
  }>;
}

export interface SnapshotArtifactStore {
  provider: string;
  putFile(input: {
    filePath: string;
    storageKey: string;
    mimeType: string | null;
    checksumSha256: string;
    byteCount: number;
  }): Promise<{ storageKey: string; etag?: string | null }>;
}

type CurrentDocumentVersion = {
  opportunityDocumentId: string;
  opportunityDocumentVersionId: string;
  source: string;
  sourceDocumentKey: string;
  filename: string;
  mimeType: string | null;
  checksumSha256: string | null;
  versionNumber: number;
};

export type PursuitSnapshotDocument = {
  id: string;
  opportunityDocumentId: string;
  opportunityDocumentVersionId: string;
  sourceBinaryArtifactId: string | null;
  source: string;
  sourceDocumentKey: string;
  filename: string;
  mimeType: string | null;
  checksumSha256: string | null;
  status: string;
  failureCode: string | null;
  retrievedAt: Date | null;
};

export type PursuitSnapshot = {
  id: string;
  opportunityId: string;
  savedOpportunityId: string | null;
  bidWorkspaceId: string | null;
  supersedesSnapshotId: string | null;
  documentSetFingerprint: string;
  status: string;
  totalDocumentCount: number;
  storedDocumentCount: number;
  blockedDocumentCount: number;
  failedDocumentCount: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  documents: PursuitSnapshotDocument[];
};

function documentSetFingerprint(documents: CurrentDocumentVersion[]) {
  const identity = documents.map((document) => ({
    documentId: document.opportunityDocumentId,
    versionId: document.opportunityDocumentVersionId,
    sourceDocumentKey: document.sourceDocumentKey,
    versionNumber: document.versionNumber,
    checksumSha256: document.checksumSha256,
  }));
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

async function loadCurrentDocumentVersions(opportunityId: string) {
  const db = getDb();
  const rows = await db
    .select({
      opportunityDocumentId: opportunityDocuments.id,
      opportunityDocumentVersionId: opportunityDocumentVersions.id,
      source: opportunities.source,
      sourceDocumentKey: opportunityDocuments.sourceDocumentKey,
      filename: opportunityDocumentVersions.name,
      mimeType: opportunityDocumentVersions.mimeType,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
      versionNumber: opportunityDocumentVersions.versionNumber,
    })
    .from(opportunityDocuments)
    .innerJoin(opportunities, eq(opportunities.id, opportunityDocuments.opportunityId))
    .innerJoin(
      opportunityDocumentVersions,
      eq(opportunityDocumentVersions.opportunityDocumentId, opportunityDocuments.id),
    )
    .where(
      and(
        eq(opportunityDocuments.opportunityId, opportunityId),
        eq(opportunityDocuments.isActive, true),
      ),
    )
    .orderBy(asc(opportunityDocuments.sourceDocumentKey), desc(opportunityDocumentVersions.versionNumber));

  const latest = new Map<string, CurrentDocumentVersion>();
  for (const row of rows) {
    if (!latest.has(row.opportunityDocumentId)) latest.set(row.opportunityDocumentId, row);
  }
  return [...latest.values()].sort((left, right) =>
    left.sourceDocumentKey.localeCompare(right.sourceDocumentKey),
  );
}

async function loadSnapshot(snapshotId: string): Promise<PursuitSnapshot | null> {
  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(pursuitDocumentSnapshots)
    .where(eq(pursuitDocumentSnapshots.id, snapshotId))
    .limit(1);
  if (!snapshot) return null;

  const documents = await db
    .select({
      id: pursuitSnapshotDocuments.id,
      opportunityDocumentId: pursuitSnapshotDocuments.opportunityDocumentId,
      opportunityDocumentVersionId: pursuitSnapshotDocuments.opportunityDocumentVersionId,
      sourceBinaryArtifactId: pursuitSnapshotDocuments.sourceBinaryArtifactId,
      source: pursuitSnapshotDocuments.source,
      sourceDocumentKey: pursuitSnapshotDocuments.sourceDocumentKey,
      filename: pursuitSnapshotDocuments.filename,
      mimeType: pursuitSnapshotDocuments.mimeType,
      checksumSha256: pursuitSnapshotDocuments.checksumSha256,
      status: pursuitSnapshotDocuments.status,
      failureCode: pursuitSnapshotDocuments.failureCode,
      retrievedAt: pursuitSnapshotDocuments.retrievedAt,
    })
    .from(pursuitSnapshotDocuments)
    .where(eq(pursuitSnapshotDocuments.pursuitSnapshotId, snapshot.id))
    .orderBy(asc(pursuitSnapshotDocuments.sourceDocumentKey));

  return { ...snapshot, documents };
}

export async function getLatestPursuitSnapshot(opportunityId: string) {
  const db = getDb();
  const [snapshot] = await db
    .select({ id: pursuitDocumentSnapshots.id })
    .from(pursuitDocumentSnapshots)
    .where(eq(pursuitDocumentSnapshots.opportunityId, opportunityId))
    .orderBy(desc(pursuitDocumentSnapshots.createdAt), desc(pursuitDocumentSnapshots.id))
    .limit(1);
  return snapshot ? loadSnapshot(snapshot.id) : null;
}

export async function ensurePursuitSnapshotPrepared(opportunityId: string) {
  const db = getDb();
  const [saved] = await db
    .select({ id: savedOpportunities.id, status: savedOpportunities.status })
    .from(savedOpportunities)
    .where(eq(savedOpportunities.opportunityId, opportunityId))
    .limit(1);

  if (!saved || saved.status !== "pursuing") {
    throw new Error("A pursuit snapshot requires the opportunity to be in Pursuing status");
  }

  const currentDocuments = await loadCurrentDocumentVersions(opportunityId);
  const fingerprint = documentSetFingerprint(currentDocuments);
  const [existing] = await db
    .select({ id: pursuitDocumentSnapshots.id })
    .from(pursuitDocumentSnapshots)
    .where(
      and(
        eq(pursuitDocumentSnapshots.savedOpportunityId, saved.id),
        eq(pursuitDocumentSnapshots.documentSetFingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (existing) return (await loadSnapshot(existing.id))!;

  const [previous] = await db
    .select({ id: pursuitDocumentSnapshots.id })
    .from(pursuitDocumentSnapshots)
    .where(eq(pursuitDocumentSnapshots.savedOpportunityId, saved.id))
    .orderBy(desc(pursuitDocumentSnapshots.createdAt), desc(pursuitDocumentSnapshots.id))
    .limit(1);

  const [created] = await db
    .insert(pursuitDocumentSnapshots)
    .values({
      opportunityId,
      savedOpportunityId: saved.id,
      supersedesSnapshotId: previous?.id ?? null,
      documentSetFingerprint: fingerprint,
      status: "incomplete",
      totalDocumentCount: currentDocuments.length,
      storedDocumentCount: 0,
      blockedDocumentCount: 0,
      failedDocumentCount: 0,
    })
    .returning({ id: pursuitDocumentSnapshots.id });
  if (!created) throw new Error("Failed to prepare pursuit document snapshot");

  const priorArtifactByVersion = new Map<string, string>();
  if (previous) {
    const priorDocuments = await db
      .select({
        versionId: pursuitSnapshotDocuments.opportunityDocumentVersionId,
        artifactId: pursuitSnapshotDocuments.sourceBinaryArtifactId,
      })
      .from(pursuitSnapshotDocuments)
      .where(eq(pursuitSnapshotDocuments.pursuitSnapshotId, previous.id));
    for (const document of priorDocuments) {
      if (document.artifactId) priorArtifactByVersion.set(document.versionId, document.artifactId);
    }
  }

  if (currentDocuments.length > 0) {
    await db.insert(pursuitSnapshotDocuments).values(
      currentDocuments.map((document) => {
        const reusedArtifactId = priorArtifactByVersion.get(document.opportunityDocumentVersionId);
        return {
          pursuitSnapshotId: created.id,
          opportunityDocumentId: document.opportunityDocumentId,
          opportunityDocumentVersionId: document.opportunityDocumentVersionId,
          sourceBinaryArtifactId: reusedArtifactId ?? null,
          source: document.source,
          sourceDocumentKey: document.sourceDocumentKey,
          filename: document.filename,
          mimeType: document.mimeType,
          checksumSha256: document.checksumSha256,
          status: reusedArtifactId ? "stored" : "pending",
        };
      }),
    );
  }

  const reusedCount = currentDocuments.filter((document) =>
    priorArtifactByVersion.has(document.opportunityDocumentVersionId),
  ).length;
  await db
    .update(pursuitDocumentSnapshots)
    .set({ storedDocumentCount: reusedCount, updatedAt: new Date() })
    .where(eq(pursuitDocumentSnapshots.id, created.id));
  await db
    .update(savedOpportunities)
    .set({ snapshotStatus: "incomplete", updatedAt: new Date() })
    .where(eq(savedOpportunities.id, saved.id));

  return (await loadSnapshot(created.id))!;
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "document";
}

function storageKeyForChecksum(checksumSha256: string) {
  return `pursuit-source/${checksumSha256.slice(0, 2)}/${checksumSha256}`;
}

function retrievalFailure(error: unknown): { status: "blocked" | "missing" | "failed"; code: string } {
  if (error instanceof SnapshotRetrievalError) {
    if (error.code === "auth_blocked" || error.code === "source_restricted" || error.code === "storage_unavailable") {
      return { status: "blocked", code: error.code };
    }
    if (error.code === "missing") return { status: "missing", code: error.code };
    return { status: "failed", code: error.code };
  }
  return { status: "failed", code: "unknown" };
}

export async function processPursuitSnapshot(
  snapshotId: string,
  options: {
    retriever: PursuitDocumentRetriever;
    artifactStore: SnapshotArtifactStore;
    tempRoot: string;
    maxDocumentBytes: number;
    maxSnapshotBytes: number;
  },
) {
  const db = getDb();
  const snapshot = await loadSnapshot(snapshotId);
  if (!snapshot) throw new Error(`Pursuit snapshot ${snapshotId} was not found`);
  if (options.maxDocumentBytes <= 0 || options.maxSnapshotBytes <= 0) {
    throw new Error("Pursuit snapshot byte limits must be positive");
  }

  const workDir = join(options.tempRoot, `snapshot-${snapshot.id}`);
  await mkdir(workDir, { recursive: true });
  let snapshotBytes = 0;

  try {
    for (const document of snapshot.documents) {
      if (document.status === "stored" && document.sourceBinaryArtifactId) continue;
      const destinationPath = join(
        workDir,
        `${document.id}-${safeFilePart(document.filename)}`,
      );

      try {
        const retrieval = await options.retriever.retrieveToFile({
          opportunityId: snapshot.opportunityId,
          opportunityDocumentId: document.opportunityDocumentId,
          opportunityDocumentVersionId: document.opportunityDocumentVersionId,
          source: document.source,
          sourceDocumentKey: document.sourceDocumentKey,
          filename: document.filename,
          mimeType: document.mimeType,
          expectedChecksumSha256: document.checksumSha256,
          destinationPath,
          maxBytes: options.maxDocumentBytes,
        });
        const file = await stat(destinationPath);
        if (file.size > options.maxDocumentBytes) {
          throw new SnapshotRetrievalError("size", "Document exceeds the pursuit snapshot per-file limit");
        }
        if (snapshotBytes + file.size > options.maxSnapshotBytes) {
          throw new SnapshotRetrievalError("size", "Pursuit snapshot exceeds the aggregate byte limit");
        }

        const checksumSha256 = await hashFile(destinationPath);
        if (
          document.checksumSha256 &&
          checksumSha256.toLowerCase() !== document.checksumSha256.toLowerCase()
        ) {
          throw new SnapshotRetrievalError(
            "checksum_mismatch",
            "Retrieved source bytes do not match the immutable document version checksum",
          );
        }

        let [artifact] = await db
          .select({ id: sourceBinaryArtifacts.id })
          .from(sourceBinaryArtifacts)
          .where(eq(sourceBinaryArtifacts.checksumSha256, checksumSha256))
          .limit(1);

        if (!artifact) {
          const storageKey = storageKeyForChecksum(checksumSha256);
          const stored = await options.artifactStore.putFile({
            filePath: destinationPath,
            storageKey,
            mimeType: retrieval.mimeType ?? document.mimeType,
            checksumSha256,
            byteCount: file.size,
          });
          await db
            .insert(sourceBinaryArtifacts)
            .values({
              checksumSha256,
              storageProvider: options.artifactStore.provider,
              storageKey: stored.storageKey,
              byteCount: file.size,
              mimeType: retrieval.mimeType ?? document.mimeType,
              etag: stored.etag ?? null,
            })
            .onConflictDoNothing();
          [artifact] = await db
            .select({ id: sourceBinaryArtifacts.id })
            .from(sourceBinaryArtifacts)
            .where(eq(sourceBinaryArtifacts.checksumSha256, checksumSha256))
            .limit(1);
        }
        if (!artifact) throw new Error("Stored pursuit artifact could not be resolved");

        snapshotBytes += file.size;
        await db
          .update(pursuitSnapshotDocuments)
          .set({
            sourceBinaryArtifactId: artifact.id,
            checksumSha256,
            status: "stored",
            failureCode: null,
            retrievedAt: retrieval.retrievedAt,
            updatedAt: new Date(),
          })
          .where(eq(pursuitSnapshotDocuments.id, document.id));
      } catch (error) {
        const failure = retrievalFailure(error);
        await db
          .update(pursuitSnapshotDocuments)
          .set({
            status: failure.status,
            failureCode: failure.code,
            updatedAt: new Date(),
          })
          .where(eq(pursuitSnapshotDocuments.id, document.id));
      } finally {
        await rm(destinationPath, { force: true }).catch(() => undefined);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const refreshed = await loadSnapshot(snapshot.id);
  if (!refreshed) throw new Error("Pursuit snapshot disappeared during processing");
  const stored = refreshed.documents.filter((document) => document.status === "stored").length;
  const blocked = refreshed.documents.filter((document) => document.status === "blocked").length;
  const failed = refreshed.documents.filter(
    (document) => document.status === "failed" || document.status === "missing",
  ).length;
  const status = blocked > 0 ? "blocked" : stored === refreshed.documents.length ? "complete" : "incomplete";
  const now = new Date();

  await db
    .update(pursuitDocumentSnapshots)
    .set({
      status,
      storedDocumentCount: stored,
      blockedDocumentCount: blocked,
      failedDocumentCount: failed,
      completedAt: status === "complete" ? now : null,
      updatedAt: now,
    })
    .where(eq(pursuitDocumentSnapshots.id, snapshot.id));

  if (snapshot.savedOpportunityId) {
    await db
      .update(savedOpportunities)
      .set({
        snapshotStatus: status === "complete" ? "complete" : status === "blocked" ? "blocked" : "incomplete",
        updatedAt: now,
      })
      .where(eq(savedOpportunities.id, snapshot.savedOpportunityId));
  }

  return {
    id: snapshot.id,
    status,
    total: refreshed.documents.length,
    stored,
    blocked,
    failed,
  };
}
