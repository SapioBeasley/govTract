import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import { getDb } from "@/lib/db/client";
import { pursuitSnapshotDocuments, sourceBinaryArtifacts } from "@/lib/db/pursuit-snapshots-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string; documentId: string }> };

/** The original immutable source binary, never an extracted or AI-generated substitute. */
export async function GET(_request: Request, context: Context) {
  const { id, documentId } = await context.params;
  if (!UUID.test(id) || !UUID.test(documentId)) return new Response("Not found", { status: 404 });

  const workspace = await getBidWorkspace(id);
  const snapshotId = workspace?.sourceSnapshot.pursuitSnapshotId;
  const snapshotDocument = workspace?.sourceSnapshot.documents.find((doc) => doc.id === documentId);
  if (!snapshotId || !snapshotDocument || snapshotDocument.status !== "stored") {
    return new Response("Original source file is not available in this bid snapshot.", { status: 404 });
  }

  const db = getDb();
  const [file] = await db.select({
    filename: pursuitSnapshotDocuments.filename,
    checksum: pursuitSnapshotDocuments.checksumSha256,
    artifactChecksum: sourceBinaryArtifacts.checksumSha256,
    provider: sourceBinaryArtifacts.storageProvider,
    storageKey: sourceBinaryArtifacts.storageKey,
    mimeType: pursuitSnapshotDocuments.mimeType,
  }).from(pursuitSnapshotDocuments)
    .innerJoin(sourceBinaryArtifacts,
      eq(sourceBinaryArtifacts.id, pursuitSnapshotDocuments.sourceBinaryArtifactId))
    .where(and(eq(pursuitSnapshotDocuments.id, documentId),
      eq(pursuitSnapshotDocuments.pursuitSnapshotId, snapshotId)))
    .limit(1);

  if (!file || !file.checksum || file.checksum !== file.artifactChecksum ||
      file.checksum !== snapshotDocument.checksumSha256 || file.provider !== "vercel_blob") {
    return new Response("Original source file could not be verified.", { status: 409 });
  }

  try {
    const result = await get(file.storageKey, { access: "private" });
    if (!result?.stream) return new Response("Original source file not found in storage.", { status: 404 });
    const filename = file.filename.replace(/[^\x20-\x7E]|["\\]/g, "_").slice(0, 180) || "source-file";
    return new Response(result.stream, {
      headers: {
        "content-type": file.mimeType ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Original source file is temporarily unavailable.", { status: 503 });
  }
}
