import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunityDocumentVersions } from "@/lib/db/schema";
import { createVercelBlobSnapshotArtifactStore } from "./artifact-store";
import { createBeaconPursuitDocumentRetriever } from "./beacon-retriever";
import {
  ensureBidWorkspaceSnapshotPrepared, processPursuitSnapshot,
  type PursuitSnapshot,
} from "./snapshot";

const MAX_DOCUMENTS = 5;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

/** A single explicit user action may only retrieve a small, source-backed package. */
export function assessManualSnapshotRefresh(input: {
  snapshot: PursuitSnapshot;
  expectedFileSizes: Array<number | null>;
}): {state: "ready" | "already_complete" | "blocked"; pendingDocuments: number; reason?: string} {
  const { snapshot, expectedFileSizes } = input;
  const unretained = snapshot.documents.filter((document) =>
    document.status !== "stored" || !document.sourceBinaryArtifactId);
  if (!snapshot.documents.length || snapshot.documents.length !== snapshot.totalDocumentCount) {
    return {state:"blocked",pendingDocuments:unretained.length,reason:"No complete authoritative source-document inventory is available. Check the procurement source and the bounded batch job."};
  }
  if (snapshot.documents.some((document) => document.source.toLowerCase() !== "beacon")) {
    return {state:"blocked",pendingDocuments:unretained.length,reason:"On-demand source retention is not configured for this procurement source. Run its authorized source-adapter batch."};
  }
  if (snapshot.documents.length > MAX_DOCUMENTS || expectedFileSizes.length !== snapshot.documents.length ||
    expectedFileSizes.some((size) => size !== null && (!Number.isFinite(size) || size < 0 || size > MAX_DOCUMENT_BYTES)) ||
    expectedFileSizes.reduce<number>((total,size) => total + (size ?? 0),0) > MAX_SNAPSHOT_BYTES) {
    return {state:"blocked",pendingDocuments:unretained.length,reason:"This solicitation package exceeds the 5-document / 10 MB per-file / 20 MB total on-demand limit. Use the bounded source-snapshot batch job."};
  }
  if (!unretained.length && snapshot.status === "complete") {
    return {state:"already_complete",pendingDocuments:0};
  }
  return {state:"ready",pendingDocuments:unretained.length};
}

/**
 * Explicitly requested, bounded original-source retention. Does not regenerate
 * understanding, call Gemini, modify the original files or create a bid draft.
 * For large packages, use the existing bounded batch worker.
 */
export async function refreshBidSourceSnapshot(workspaceId: string) {
  const snapshot = await ensureBidWorkspaceSnapshotPrepared(workspaceId);
  const db = getDb();
  const versions = snapshot.documents.length ? await db.select({
    id:opportunityDocumentVersions.id,
    size:opportunityDocumentVersions.fileSizeBytes,
  }).from(opportunityDocumentVersions).where(inArray(
    opportunityDocumentVersions.id,
    snapshot.documents.map((document)=>document.opportunityDocumentVersionId),
  )) : [];
  const sizes = new Map(versions.map((version) => [version.id,version.size]));
  const decision = assessManualSnapshotRefresh({
    snapshot,expectedFileSizes:snapshot.documents.map((document) =>
      sizes.get(document.opportunityDocumentVersionId) ?? null),
  });
  if (decision.state === "blocked") throw new Error(decision.reason);
  if (decision.state === "already_complete") {
    return {state:"complete" as const,stored:snapshot.storedDocumentCount,
      total:snapshot.totalDocumentCount,blocked:0,failed:0};
  }
  const tempRoot = await mkdtemp(join(tmpdir(),"govtract-manual-snapshot-"));
  try {
    const result = await processPursuitSnapshot(snapshot.id,{
      retriever:createBeaconPursuitDocumentRetriever(),
      artifactStore:createVercelBlobSnapshotArtifactStore(),
      tempRoot,maxDocumentBytes:MAX_DOCUMENT_BYTES,maxSnapshotBytes:MAX_SNAPSHOT_BYTES,
    });
    return {state:result.status,stored:result.stored,total:result.total,
      blocked:result.blocked,failed:result.failed};
  } finally {
    await rm(tempRoot,{recursive:true,force:true}).catch(()=>undefined);
  }
}
