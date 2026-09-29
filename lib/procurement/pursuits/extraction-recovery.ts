import { createHash } from "node:crypto";

import { get } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
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
  persistDocumentExtractionFailure,
  reuseDocumentExtractionIfAvailable,
} from "@/lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "@/lib/procurement/documents/extractions";
import type { PursuitSnapshot } from "@/lib/procurement/pursuits/snapshot";

const MAX_RECOVERY_BYTES = 20 * 1024 * 1024;

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Deterministically ensures stored current source binaries have extraction rows.
 * This never calls AI and never mutates source bytes.
 */
export async function ensureStoredSnapshotExtractions(snapshot: PursuitSnapshot) {
  const candidates = snapshot.documents.filter((document) =>
    document.status === "stored" &&
    Boolean(document.sourceBinaryArtifactId) &&
    Boolean(document.checksumSha256),
  );
  if (!candidates.length) return { extracted: 0, reused: 0, failed: 0 };

  const db = getDb();
  const artifactIds = candidates
    .map((document) => document.sourceBinaryArtifactId)
    .filter((id): id is string => Boolean(id));
  const artifacts = await db
    .select({
      id: sourceBinaryArtifacts.id,
      checksumSha256: sourceBinaryArtifacts.checksumSha256,
      storageProvider: sourceBinaryArtifacts.storageProvider,
      storageKey: sourceBinaryArtifacts.storageKey,
      byteCount: sourceBinaryArtifacts.byteCount,
      mimeType: sourceBinaryArtifacts.mimeType,
    })
    .from(sourceBinaryArtifacts)
    .where(inArray(sourceBinaryArtifacts.id, artifactIds));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  let extracted = 0;
  let reused = 0;
  let failed = 0;

  for (const document of candidates) {
    const checksum = document.checksumSha256 as string;
    const descriptor = getDocumentExtractorDescriptor({
      name: document.filename,
      mimeType: document.mimeType,
    });
    if (!descriptor) continue;

    const existing = await reuseDocumentExtractionIfAvailable({
      documentVersionIds: [document.opportunityDocumentVersionId],
      checksumSha256: checksum,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
    });
    if (existing) {
      reused += 1;
      continue;
    }

    const artifact = document.sourceBinaryArtifactId
      ? artifactById.get(document.sourceBinaryArtifactId)
      : null;
    if (
      !artifact ||
      artifact.storageProvider !== "vercel_blob" ||
      artifact.checksumSha256.toLowerCase() !== checksum.toLowerCase() ||
      artifact.byteCount > MAX_RECOVERY_BYTES
    ) {
      failed += 1;
      continue;
    }

    try {
      const result = await get(artifact.storageKey, { access: "private" });
      if (!result?.stream) throw new Error("Stored source binary is unavailable");
      const body = Buffer.from(await new Response(result.stream).arrayBuffer());
      if (body.byteLength > MAX_RECOVERY_BYTES || sha256(body).toLowerCase() !== checksum.toLowerCase()) {
        throw new Error("Stored source binary failed checksum verification");
      }

      const extraction = await extractDocumentContent({
        name: document.filename,
        mimeType: document.mimeType ?? artifact.mimeType,
        buffer: body,
      });
      const prepared = prepareExtractionSegments(extraction.segments);
      if (extraction.metadata.partialExtraction === true && !prepared.truncated) {
        prepared.truncated = true;
        prepared.truncationReason = "extractor_partial";
      }
      await persistDocumentExtraction({
        documentVersionIds: [document.opportunityDocumentVersionId],
        checksumSha256: checksum,
        extractorName: extraction.extractorName,
        extractorVersion: extraction.extractorVersion,
        sourceMimeType: document.mimeType ?? artifact.mimeType,
        sourceByteCount: body.byteLength,
        metadata: { source: document.source, recovery: "retained_snapshot" },
        prepared,
      });
      extracted += 1;
    } catch {
      await persistDocumentExtractionFailure({
        documentVersionIds: [document.opportunityDocumentVersionId],
        checksumSha256: checksum,
        extractorName: descriptor.extractorName,
        extractorVersion: descriptor.extractorVersion,
        sourceMimeType: document.mimeType ?? artifact?.mimeType ?? null,
        sourceByteCount: artifact?.byteCount ?? null,
        failureCode: "retained_source_extraction_failed",
        metadata: { source: document.source, recovery: "retained_snapshot" },
      }).catch(() => undefined);
      failed += 1;
    }
  }

  return { extracted, reused, failed };
}
