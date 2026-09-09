import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";

import { closeDb, getDb } from "../lib/db/client";
import {
  opportunities,
  opportunityDocuments,
  opportunityDocumentVersions,
} from "../lib/db/schema";
import {
  isSupportedDocumentType,
  persistOpportunityDocumentSet,
  type PersistableDocument,
} from "../lib/procurement/documents/persistence";
import { enrichBeaconDocumentMetadata } from "../lib/procurement/sources/beacon/documents";

const SOURCE = "beacon";
const AGENCY_SLUG = process.env.BEACON_AGENCY ?? "city-of-houston";
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const DOCUMENT_ARTIFACT_DIR = join(ARTIFACT_DIR, "documents");
const MAX_BYTES = Number(process.env.BEACON_DOCUMENT_MAX_BYTES ?? String(300 * 1024 * 1024));
const CONCURRENCY = Math.max(1, Number(process.env.BEACON_DOCUMENT_CONCURRENCY ?? "4"));
const REQUEST_TIMEOUT_MS = Number(process.env.BEACON_DOCUMENT_TIMEOUT_MS ?? "120000");
const FORCE_REHASH = process.env.BEACON_DOCUMENT_FORCE_REHASH === "true";

interface DocumentRow {
  documentId: string;
  opportunityId: string;
  sourceOpportunityId: string;
  sourceDocumentKey: string;
  sourceDocumentId: string | null;
  name: string;
  url: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sourceMetadata: Record<string, unknown>;
}

interface RetrievedDocument {
  document: PersistableDocument;
  bytesRead: number;
  skippedDownload: boolean;
  error?: string;
}

interface ReprocessSignal {
  opportunityId: string;
  sourceOpportunityId: string;
  documentId: string;
  sourceDocumentKey: string;
  versionNumber: number;
  change: string;
  isAmendment: boolean;
  amendmentLabel: string | null;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function numberHeader(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init?.headers);
  headers.set("user-agent", "govTract/0.1 public-procurement-indexer");

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function hashResponseBody(response: Response) {
  if (!response.body) throw new Error("Document response did not include a body");

  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let bytesRead = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > MAX_BYTES) {
        await reader.cancel("govTract document size bound exceeded");
        throw new Error(
          `Document exceeded BEACON_DOCUMENT_MAX_BYTES (${MAX_BYTES} bytes) while streaming`,
        );
      }
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { checksumSha256: hash.digest("hex"), bytesRead };
}

async function latestChecksum(documentId: string) {
  const db = getDb();
  const [latest] = await db
    .select({ checksumSha256: opportunityDocumentVersions.checksumSha256 })
    .from(opportunityDocumentVersions)
    .where(eq(opportunityDocumentVersions.opportunityDocumentId, documentId))
    .orderBy(desc(opportunityDocumentVersions.versionNumber))
    .limit(1);

  return latest?.checksumSha256 ?? null;
}

async function retrieveDocument(row: DocumentRow): Promise<RetrievedDocument> {
  const base = enrichBeaconDocumentMetadata({
    sourceDocumentKey: row.sourceDocumentKey,
    sourceDocumentId: row.sourceDocumentId,
    name: row.name,
    url: row.url,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    sourceMetadata: row.sourceMetadata,
  });

  if (!base.url) {
    return {
      document: base,
      bytesRead: 0,
      skippedDownload: true,
      error: "No resolvable Beacon document URL",
    };
  }

  if (!isSupportedDocumentType(base)) {
    return { document: base, bytesRead: 0, skippedDownload: true };
  }

  if (base.fileSizeBytes && base.fileSizeBytes > MAX_BYTES) {
    return {
      document: base,
      bytesRead: 0,
      skippedDownload: true,
      error: `Source metadata reports ${base.fileSizeBytes} bytes, above BEACON_DOCUMENT_MAX_BYTES=${MAX_BYTES}`,
    };
  }

  const checksum = await latestChecksum(row.documentId);
  if (checksum && !FORCE_REHASH) {
    return { document: base, bytesRead: 0, skippedDownload: true };
  }

  const response = await fetchWithTimeout(base.url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Beacon document returned HTTP ${response.status}: ${base.url}`);
  }

  const responseSize = numberHeader(response.headers.get("content-length"));
  if (responseSize && responseSize > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(
      `Beacon document reports ${responseSize} bytes, above BEACON_DOCUMENT_MAX_BYTES=${MAX_BYTES}`,
    );
  }

  const hashed = await hashResponseBody(response);
  const responseMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;

  return {
    document: {
      ...base,
      mimeType: base.mimeType ?? responseMimeType,
      fileSizeBytes: base.fileSizeBytes ?? responseSize ?? hashed.bytesRead,
      checksumSha256: hashed.checksumSha256,
      retrievedAt: new Date(),
      storageMode: "source",
      contentPersisted: false,
    },
    bytesRead: hashed.bytesRead,
    skippedDownload: false,
  };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Beacon document ingestion");
  }

  await mkdir(DOCUMENT_ARTIFACT_DIR, { recursive: true });
  const db = getDb();
  const rows = await db
    .select({
      documentId: opportunityDocuments.id,
      opportunityId: opportunities.id,
      sourceOpportunityId: opportunities.sourceOpportunityId,
      sourceDocumentKey: opportunityDocuments.sourceDocumentKey,
      sourceDocumentId: opportunityDocuments.sourceDocumentId,
      name: opportunityDocuments.name,
      url: opportunityDocuments.url,
      mimeType: opportunityDocuments.mimeType,
      fileSizeBytes: opportunityDocuments.fileSizeBytes,
      sourceMetadata: opportunityDocuments.sourceMetadata,
    })
    .from(opportunityDocuments)
    .innerJoin(opportunities, eq(opportunities.id, opportunityDocuments.opportunityId))
    .where(
      and(
        eq(opportunities.source, SOURCE),
        eq(opportunities.agencySlug, AGENCY_SLUG),
        eq(opportunities.isActive, true),
        eq(opportunityDocuments.isActive, true),
      ),
    );

  const byOpportunity = new Map<string, DocumentRow[]>();
  for (const row of rows) {
    const existing = byOpportunity.get(row.opportunityId) ?? [];
    existing.push(row);
    byOpportunity.set(row.opportunityId, existing);
  }

  const reprocess: ReprocessSignal[] = [];
  const errors: Array<{ opportunityId: string; sourceDocumentKey: string; error: string }> = [];
  let downloaded = 0;
  let skippedDownloads = 0;
  let bytesRead = 0;
  let processedDocuments = 0;

  for (const [opportunityId, documents] of byOpportunity) {
    const retrieved = await mapConcurrent(documents, CONCURRENCY, async (row) => {
      try {
        return await retrieveDocument(row);
      } catch (error) {
        const message = errorText(error);
        errors.push({ opportunityId, sourceDocumentKey: row.sourceDocumentKey, error: message });
        return {
          document: enrichBeaconDocumentMetadata({
            sourceDocumentKey: row.sourceDocumentKey,
            sourceDocumentId: row.sourceDocumentId,
            name: row.name,
            url: row.url,
            mimeType: row.mimeType,
            fileSizeBytes: row.fileSizeBytes,
            sourceMetadata: row.sourceMetadata,
          }),
          bytesRead: 0,
          skippedDownload: true,
          error: message,
        } satisfies RetrievedDocument;
      }
    });

    for (const result of retrieved) {
      processedDocuments += 1;
      bytesRead += result.bytesRead;
      if (result.skippedDownload) skippedDownloads += 1;
      else downloaded += 1;
      if (result.error) {
        console.error(
          `BEACON_DOCUMENT_ERROR opportunity=${opportunityId} key=${result.document.sourceDocumentKey} ${result.error}`,
        );
      }
    }

    const persistenceResults = await persistOpportunityDocumentSet({
      opportunityId,
      documents: retrieved.map((result) => result.document),
    });
    const sourceOpportunityId = documents[0]?.sourceOpportunityId ?? opportunityId;
    const retrievedByKey = new Map(
      retrieved.map((result) => [result.document.sourceDocumentKey, result]),
    );

    for (const result of persistenceResults) {
      const source = retrievedByKey.get(result.sourceDocumentKey)?.document;
      if (!result.requiresProcessing || !source) continue;

      reprocess.push({
        opportunityId,
        sourceOpportunityId,
        documentId: result.documentId,
        sourceDocumentKey: result.sourceDocumentKey,
        versionNumber: result.versionNumber,
        change: result.change,
        isAmendment: source.isAmendment ?? false,
        amendmentLabel: source.amendmentLabel ?? null,
      });
      console.log(
        `BEACON_REPROCESS opportunity=${opportunityId} document=${result.documentId} version=${result.versionNumber} change=${result.change} amendment=${source.isAmendment ?? false}`,
      );
    }
  }

  const summary = {
    source: SOURCE,
    agency: AGENCY_SLUG,
    completedAt: new Date().toISOString(),
    opportunityCount: byOpportunity.size,
    documentCount: rows.length,
    processedDocuments,
    downloaded,
    skippedDownloads,
    bytesRead,
    errorCount: errors.length,
    reprocessCount: reprocess.length,
    maxBytes: MAX_BYTES,
    concurrency: CONCURRENCY,
    forceRehash: FORCE_REHASH,
  };

  await writeFile(
    join(DOCUMENT_ARTIFACT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  await writeFile(
    join(DOCUMENT_ARTIFACT_DIR, "reprocess.json"),
    JSON.stringify(reprocess, null, 2),
    "utf8",
  );
  await writeFile(
    join(DOCUMENT_ARTIFACT_DIR, "errors.json"),
    JSON.stringify(errors, null, 2),
    "utf8",
  );

  console.log(`BEACON_DOCUMENT_SUMMARY ${JSON.stringify(summary)}`);
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
