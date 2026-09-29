import { createHash } from "node:crypto";

import { get } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import { getDb } from "@/lib/db/client";
import {
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";
import {
  pursuitSnapshotDocuments,
  sourceBinaryArtifacts,
} from "@/lib/db/pursuit-snapshots-schema";
import {
  extractDocumentContent,
  getDocumentExtractorDescriptor,
} from "@/lib/procurement/documents/extract-content";
import {
  persistDocumentExtraction,
  reuseDocumentExtractionIfAvailable,
} from "@/lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "@/lib/procurement/documents/extractions";

const MAX_EXTRACTION_BYTES = 10 * 1024 * 1024;

/** Deterministically extracts already-retained current snapshot files. No source or AI calls. */
export async function ensureStoredSnapshotExtractions(workspaceId: string) {
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const snapshotId = workspace.sourceSnapshot.pursuitSnapshotId;
  if (!snapshotId) throw new Error("Current source snapshot is unavailable.");

  const db = getDb();
  const rows = await db
    .select({
      versionId: pursuitSnapshotDocuments.opportunityDocumentVersionId,
      filename: pursuitSnapshotDocuments.filename,
      mimeType: pursuitSnapshotDocuments.mimeType,
      checksum: pursuitSnapshotDocuments.checksumSha256,
      status: pursuitSnapshotDocuments.status,
      artifactChecksum: sourceBinaryArtifacts.checksumSha256,
      provider: sourceBinaryArtifacts.storageProvider,
      storageKey: sourceBinaryArtifacts.storageKey,
      byteCount: sourceBinaryArtifacts.byteCount,
    })
    .from(pursuitSnapshotDocuments)
    .innerJoin(
      sourceBinaryArtifacts,
      eq(sourceBinaryArtifacts.id, pursuitSnapshotDocuments.sourceBinaryArtifactId),
    )
    .where(eq(pursuitSnapshotDocuments.pursuitSnapshotId, snapshotId));

  if (rows.length !== workspace.sourceSnapshot.totalDocumentCount ||
      rows.some((row) => row.status !== "stored")) {
    throw new Error("The current retained source package is incomplete.");
  }

  let extracted = 0;
  for (const row of rows) {
    if (!row.checksum || row.checksum !== row.artifactChecksum || row.provider !== "vercel_blob") {
      throw new Error("A retained source file could not be verified.");
    }
    const descriptor = getDocumentExtractorDescriptor({
      name: row.filename,
      mimeType: row.mimeType,
    });
    if (!descriptor) continue;

    const reused = await reuseDocumentExtractionIfAvailable({
      documentVersionIds: [row.versionId],
      checksumSha256: row.checksum,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
    });
    if (reused) continue;

    const [attached] = await db
      .select({ status: documentExtractions.status })
      .from(opportunityDocumentVersionExtractions)
      .innerJoin(
        documentExtractions,
        eq(documentExtractions.id, opportunityDocumentVersionExtractions.documentExtractionId),
      )
      .where(and(
        eq(opportunityDocumentVersionExtractions.opportunityDocumentVersionId, row.versionId),
        eq(documentExtractions.checksumSha256, row.checksum),
        inArray(documentExtractions.status, ["extracted", "truncated"]),
      ))
      .limit(1);
    if (attached) continue;

    if (row.byteCount > MAX_EXTRACTION_BYTES) {
      throw new Error("A retained source file exceeds the bounded on-demand extraction limit.");
    }
    const blob = await get(row.storageKey, { access: "private" });
    if (!blob?.stream) throw new Error("A retained source file is temporarily unavailable.");
    const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
    if (buffer.byteLength > MAX_EXTRACTION_BYTES) {
      throw new Error("A retained source file exceeds the bounded on-demand extraction limit.");
    }
    const checksum = createHash("sha256").update(buffer).digest("hex");
    if (checksum !== row.checksum) throw new Error("A retained source file checksum could not be verified.");

    const result = await extractDocumentContent({
      name: row.filename,
      mimeType: row.mimeType,
      buffer,
    });
    const prepared = prepareExtractionSegments(result.segments);
    if (result.metadata.partialExtraction === true && !prepared.truncated) {
      prepared.truncated = true;
      prepared.truncationReason = "extractor_partial";
    }
    await persistDocumentExtraction({
      documentVersionIds: [row.versionId],
      checksumSha256: row.checksum,
      extractorName: result.extractorName,
      extractorVersion: result.extractorVersion,
      sourceMimeType: row.mimeType,
      sourceByteCount: row.byteCount,
      metadata: { source: "retained_snapshot", ...result.metadata },
      prepared,
    });
    extracted += 1;
  }

  return { extracted };
}
