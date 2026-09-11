import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

import { closeDb, getDb } from "../lib/db/client";
import {
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "../lib/db/document-extractions-schema";
import { opportunityDocumentVersions } from "../lib/db/schema";
import {
  listDocumentCloseoutCandidates,
  updateDocumentCloseoutStatus,
  type DocumentCloseoutCandidate,
} from "../lib/procurement/documents/closeout";
import {
  extractDocumentContent,
  getDocumentExtractorDescriptor,
} from "../lib/procurement/documents/extract-content";
import {
  persistDocumentExtraction,
  persistDocumentExtractionFailure,
  reuseDocumentExtractionIfAvailable,
} from "../lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "../lib/procurement/documents/extractions";
import { extractPdfContentFromPath } from "../lib/procurement/documents/large-pdf-content";
import { isSupportedDocumentType } from "../lib/procurement/documents/persistence";
import {
  collectDocumentStreamForExtraction,
  DocumentSourceSizeLimitError,
} from "../lib/procurement/documents/streamed-extraction-source";
import {
  enrichBeaconDocumentMetadata,
  isBeaconPresignedDocumentUrl,
  resolveBeaconDocumentDownloadUrl,
} from "../lib/procurement/sources/beacon/documents";
import {
  buildBeaconPlanholderRegistrationRequest,
  parseBeaconPlanholderRegistrationResponse,
} from "../lib/procurement/sources/beacon/registration";
import {
  buildBeaconCookieHeader,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
  parseBeaconRegistrationProfile,
  parseBeaconSessionProbe,
  type BeaconRegistrationProfile,
} from "../lib/procurement/sources/beacon/session-transport";
import {
  loadSourceConnectionSession,
  markSourceConnectionNeedsReauth,
  markSourceConnectionValidated,
  SourceConnectionUnavailableError,
} from "../lib/source-connections/repository";

const SOURCE = "beacon";
const PROVIDER = "beacon";
const BEACON_ORIGIN = "https://www.beaconbid.com";
const AGENCY_SLUG = process.env.BEACON_AGENCY ?? "city-of-houston";
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const DOCUMENT_ARTIFACT_DIR = join(ARTIFACT_DIR, "documents");
const CLOSEOUT_LIMIT = Math.max(0, Number(process.env.BEACON_DOCUMENT_CLOSEOUT_LIMIT ?? "25"));
const MAX_BYTES = Number(process.env.BEACON_DOCUMENT_MAX_BYTES ?? String(300 * 1024 * 1024));
const MAX_EXTRACTION_SOURCE_BYTES = Number(
  process.env.BEACON_EXTRACTION_MAX_SOURCE_BYTES ?? String(64 * 1024 * 1024),
);
const PDF_PAGE_BATCH_SIZE = Number(process.env.BEACON_PDF_PAGE_BATCH_SIZE ?? "8");
const REQUEST_TIMEOUT_MS = Number(process.env.BEACON_DOCUMENT_TIMEOUT_MS ?? "120000");
const RETRY_FAILED_EXTRACTIONS = process.env.BEACON_EXTRACTION_RETRY_FAILED === "true";
const AUTO_REGISTER = process.env.BEACON_AUTO_REGISTER !== "false";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-document-closeout";

type CanonicalExtraction = {
  id: string;
  status: string;
  failureCode: string | null;
};

type BeaconConnection = {
  cookieHeader: string;
  registrationProfile: BeaconRegistrationProfile | null;
};

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Unknown closeout error";
}

async function markNeedsReauth(
  reason: "session_invalid" | "authentication_failed" | "retrieval_unauthorized",
) {
  try {
    await markSourceConnectionNeedsReauth(PROVIDER, reason);
  } catch {
    // Preserve the retrieval failure as the operator-facing error.
  }
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  options: { beaconCookieHeader?: string } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init?.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("accept", "*/*");

  if (options.beaconCookieHeader) {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.origin !== BEACON_ORIGIN) {
      throw new Error("Refusing to send Beacon session credentials to an unexpected host");
    }
    headers.set("cookie", options.beaconCookieHeader);
  }

  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadValidatedBeaconConnection(): Promise<BeaconConnection> {
  let session;
  try {
    session = await loadSourceConnectionSession(PROVIDER);
  } catch (error) {
    const suffix = error instanceof SourceConnectionUnavailableError ? ` (${error.reason})` : "";
    throw new Error(`Beacon persisted source connection is unavailable${suffix}`);
  }

  let cookieHeader: string;
  try {
    cookieHeader = buildBeaconCookieHeader(session);
  } catch {
    await markNeedsReauth("session_invalid");
    throw new Error("Beacon persisted source connection is invalid");
  }

  const response = await fetchWithTimeout(
    `${BEACON_ORIGIN}/api/rest/session`,
    { method: "GET" },
    { beaconCookieHeader: cookieHeader },
  );
  const body = await response.text();
  const parsed = parseBeaconSessionProbe(response.status, body);
  if (!parsed.authenticatedSupplier) {
    await markNeedsReauth("authentication_failed");
    throw new Error("Beacon source connection no longer has supplier access");
  }

  await markSourceConnectionValidated(PROVIDER);
  return {
    cookieHeader,
    registrationProfile: parseBeaconRegistrationProfile(body),
  };
}

async function registerBeaconSolicitation(input: {
  sourceOpportunityId: string;
  connection: BeaconConnection;
}) {
  if (!AUTO_REGISTER) throw new Error("Beacon solicitation registration is required");
  if (!input.connection.registrationProfile) {
    throw new Error("Beacon supplier profile is incomplete for automatic registration");
  }

  const request = buildBeaconPlanholderRegistrationRequest({
    solicitationId: input.sourceOpportunityId,
    profile: input.connection.registrationProfile,
    interest: "Bidder",
  });
  const response = await fetchWithTimeout(
    `${BEACON_ORIGIN}/api/gql?operation=createPlanholder`,
    {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    { beaconCookieHeader: input.connection.cookieHeader },
  );
  const body = (await response.text()).slice(0, 5000);
  const result = parseBeaconPlanholderRegistrationResponse(response.status, body);
  if (!result.ok) throw new Error(`Beacon registration failed (HTTP ${response.status})`);
}

async function resolveDownloadResponse(input: {
  candidate: DocumentCloseoutCandidate;
  connection: BeaconConnection;
}) {
  const downloadUrl = resolveBeaconDocumentDownloadUrl({
    sourceOpportunityId: input.candidate.sourceOpportunityId,
    sourceDocumentKey: input.candidate.sourceDocumentKey,
  });
  if (!downloadUrl) throw new Error("Could not build Beacon document download route");

  let registered = false;
  while (true) {
    const gateway = await fetchWithTimeout(
      downloadUrl,
      { method: "GET", redirect: "manual" },
      { beaconCookieHeader: input.connection.cookieHeader },
    );

    if (gateway.status >= 300 && gateway.status < 400) {
      const location = gateway.headers.get("location");
      await gateway.body?.cancel();
      if (!location) throw new Error(`Beacon gateway redirected without a location (${gateway.status})`);
      if (
        !isBeaconPresignedDocumentUrl({
          url: location,
          sourceDocumentKey: input.candidate.sourceDocumentKey,
        })
      ) {
        throw new Error("Beacon gateway returned an unexpected redirect target");
      }
      const s3 = await fetchWithTimeout(location, { method: "GET", redirect: "manual" });
      if (!s3.ok) throw new Error(`Beacon presigned document returned HTTP ${s3.status}`);
      return s3;
    }

    if (gateway.ok) return gateway;
    const body = (await gateway.text()).slice(0, 1000);
    if (isBeaconRegistrationRequiredResponse(gateway.status, body)) {
      if (registered) throw new Error("Beacon still requires registration after automatic registration");
      await registerBeaconSolicitation({
        sourceOpportunityId: input.candidate.sourceOpportunityId,
        connection: input.connection,
      });
      registered = true;
      continue;
    }
    if (isBeaconPermissionResponse(gateway.status, body)) {
      await markNeedsReauth("retrieval_unauthorized");
      throw new Error(`Beacon denied supplier document access (HTTP ${gateway.status})`);
    }
    throw new Error(`Beacon document returned HTTP ${gateway.status}`);
  }
}

async function* responseBodyChunks(response: Response) {
  if (!response.body) throw new Error("Document response did not include a body");
  const reader = response.body.getReader();
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        return;
      }
      if (value) yield value;
    }
  } finally {
    if (!completed) await reader.cancel("govTract stopped closeout streaming").catch(() => {});
    reader.releaseLock();
  }
}

async function findCanonicalExtraction(
  checksumSha256: string,
  extractorName: string,
  extractorVersion: string,
): Promise<CanonicalExtraction | null> {
  const [row] = await getDb()
    .select({
      id: documentExtractions.id,
      status: documentExtractions.status,
      failureCode: documentExtractions.failureCode,
    })
    .from(documentExtractions)
    .where(
      and(
        eq(documentExtractions.checksumSha256, checksumSha256.toLowerCase()),
        eq(documentExtractions.extractorName, extractorName),
        eq(documentExtractions.extractorVersion, extractorVersion),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function attachExtraction(extractionId: string, documentVersionId: string) {
  await getDb()
    .insert(opportunityDocumentVersionExtractions)
    .values({
      opportunityDocumentVersionId: documentVersionId,
      documentExtractionId: extractionId,
    })
    .onConflictDoNothing();
}

async function processCandidate(
  candidate: DocumentCloseoutCandidate,
  getConnection: () => Promise<BeaconConnection>,
) {
  const base = enrichBeaconDocumentMetadata({
    sourceDocumentKey: candidate.sourceDocumentKey,
    sourceDocumentId: candidate.sourceDocumentId,
    name: candidate.name,
    url: candidate.url,
    mimeType: candidate.mimeType,
    fileSizeBytes: candidate.fileSizeBytes,
    sourceMetadata: candidate.sourceMetadata,
  });

  if (!isSupportedDocumentType(base)) {
    await updateDocumentCloseoutStatus({ closeoutId: candidate.closeoutId, status: "unsupported" });
    return "unsupported" as const;
  }
  const descriptor = getDocumentExtractorDescriptor(base);
  if (!descriptor) {
    await updateDocumentCloseoutStatus({ closeoutId: candidate.closeoutId, status: "unsupported" });
    return "unsupported" as const;
  }
  if (base.fileSizeBytes && base.fileSizeBytes > MAX_BYTES) {
    await updateDocumentCloseoutStatus({
      closeoutId: candidate.closeoutId,
      status: "failed",
      failureCode: "source_too_large",
    });
    return "failed" as const;
  }

  if (candidate.checksumSha256) {
    const reused = await reuseDocumentExtractionIfAvailable({
      documentVersionIds: [candidate.documentVersionId],
      checksumSha256: candidate.checksumSha256,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
    });
    if (reused) {
      await updateDocumentCloseoutStatus({ closeoutId: candidate.closeoutId, status: "covered" });
      return "reused" as const;
    }

    const canonical = await findCanonicalExtraction(
      candidate.checksumSha256,
      descriptor.extractorName,
      descriptor.extractorVersion,
    );
    if (canonical?.status === "failed" && !RETRY_FAILED_EXTRACTIONS) {
      await attachExtraction(canonical.id, candidate.documentVersionId);
      await updateDocumentCloseoutStatus({
        closeoutId: candidate.closeoutId,
        status: "failed",
        failureCode: canonical.failureCode,
      });
      return "failed" as const;
    }
  }

  const connection = await getConnection();
  const response = await resolveDownloadResponse({ candidate, connection });
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    await response.body?.cancel();
    await updateDocumentCloseoutStatus({
      closeoutId: candidate.closeoutId,
      status: "failed",
      failureCode: "source_too_large",
    });
    return "failed" as const;
  }

  let collected;
  try {
    collected = await collectDocumentStreamForExtraction({
      chunks: responseBodyChunks(response),
      maxBufferBytes: MAX_EXTRACTION_SOURCE_BYTES,
      maxSourceBytes: MAX_BYTES,
      spoolToDisk: descriptor.kind === "pdf",
      bufferInMemory: true,
    });
  } catch (error) {
    if (error instanceof DocumentSourceSizeLimitError) {
      await updateDocumentCloseoutStatus({
        closeoutId: candidate.closeoutId,
        status: "failed",
        failureCode: "source_too_large",
      });
      return "failed" as const;
    }
    throw error;
  }

  try {
    if (
      candidate.checksumSha256 &&
      candidate.checksumSha256.toLowerCase() !== collected.checksumSha256.toLowerCase()
    ) {
      await updateDocumentCloseoutStatus({
        closeoutId: candidate.closeoutId,
        status: "failed",
        failureCode: "checksum_changed_during_closeout",
      });
      return "failed" as const;
    }

    const sourceMimeType =
      base.mimeType ?? response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? null;
    const sourceByteCount = base.fileSizeBytes ?? collected.bytesRead;
    await getDb()
      .update(opportunityDocumentVersions)
      .set({
        checksumSha256: collected.checksumSha256,
        retrievedAt: new Date(),
        storageMode: "source",
        contentPersisted: false,
        fileSizeBytes: sourceByteCount,
        mimeType: sourceMimeType,
      })
      .where(eq(opportunityDocumentVersions.id, candidate.documentVersionId));

    const reused = await reuseDocumentExtractionIfAvailable({
      documentVersionIds: [candidate.documentVersionId],
      checksumSha256: collected.checksumSha256,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
    });
    if (reused) {
      await updateDocumentCloseoutStatus({ closeoutId: candidate.closeoutId, status: "covered" });
      return "reused" as const;
    }

    const useFileBackedPdf = descriptor.kind === "pdf" && !collected.buffer && Boolean(collected.filePath);
    if (collected.exceededBufferLimit && !useFileBackedPdf) {
      await persistDocumentExtractionFailure({
        documentVersionIds: [candidate.documentVersionId],
        checksumSha256: collected.checksumSha256,
        extractorName: descriptor.extractorName,
        extractorVersion: descriptor.extractorVersion,
        sourceMimeType,
        sourceByteCount,
        failureCode: "source_too_large",
        metadata: { source: SOURCE, closeout: true },
      });
      await updateDocumentCloseoutStatus({
        closeoutId: candidate.closeoutId,
        status: "failed",
        failureCode: "source_too_large",
      });
      return "failed" as const;
    }

    try {
      const extracted = useFileBackedPdf && collected.filePath
        ? await extractPdfContentFromPath(collected.filePath, { pageBatchSize: PDF_PAGE_BATCH_SIZE })
        : await extractDocumentContent({
            name: base.name,
            mimeType: sourceMimeType,
            buffer: collected.buffer as Buffer,
          });
      const prepared = prepareExtractionSegments(extracted.segments);
      if (extracted.metadata.partialExtraction === true && !prepared.truncated) {
        prepared.truncated = true;
        prepared.truncationReason = "extractor_partial";
      }
      await persistDocumentExtraction({
        documentVersionIds: [candidate.documentVersionId],
        checksumSha256: collected.checksumSha256,
        extractorName: extracted.extractorName,
        extractorVersion: extracted.extractorVersion,
        sourceMimeType,
        sourceByteCount,
        metadata: { source: SOURCE, closeout: true, ...extracted.metadata },
        prepared,
      });
      await updateDocumentCloseoutStatus({ closeoutId: candidate.closeoutId, status: "covered" });
      return prepared.truncated ? ("truncated" as const) : ("extracted" as const);
    } catch {
      await persistDocumentExtractionFailure({
        documentVersionIds: [candidate.documentVersionId],
        checksumSha256: collected.checksumSha256,
        extractorName: descriptor.extractorName,
        extractorVersion: descriptor.extractorVersion,
        sourceMimeType,
        sourceByteCount,
        failureCode: "extractor_error",
        metadata: { source: SOURCE, closeout: true },
      });
      await updateDocumentCloseoutStatus({
        closeoutId: candidate.closeoutId,
        status: "failed",
        failureCode: "extractor_error",
      });
      return "failed" as const;
    }
  } finally {
    await collected.cleanup();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Beacon closeout extraction");
  if (!process.env.SOURCE_SESSION_ENCRYPTION_KEY) {
    throw new Error("SOURCE_SESSION_ENCRYPTION_KEY is required for Beacon closeout extraction");
  }
  if (!Number.isSafeInteger(CLOSEOUT_LIMIT) || CLOSEOUT_LIMIT < 0) {
    throw new Error("BEACON_DOCUMENT_CLOSEOUT_LIMIT must be a non-negative integer");
  }

  await mkdir(DOCUMENT_ARTIFACT_DIR, { recursive: true });
  const candidates = await listDocumentCloseoutCandidates({
    source: SOURCE,
    agency: AGENCY_SLUG,
    limit: CLOSEOUT_LIMIT,
    retryFailed: RETRY_FAILED_EXTRACTIONS,
  });

  let connectionPromise: Promise<BeaconConnection> | null = null;
  const getConnection = () => {
    connectionPromise ??= loadValidatedBeaconConnection();
    return connectionPromise;
  };

  const counts = {
    selected: candidates.length,
    extracted: 0,
    truncated: 0,
    reused: 0,
    unsupported: 0,
    failed: 0,
    deferred: 0,
  };
  const errors: Array<{ closeoutId: string; documentVersionId: string; error: string }> = [];

  for (const candidate of candidates) {
    try {
      const result = await processCandidate(candidate, getConnection);
      if (result === "extracted") counts.extracted += 1;
      if (result === "truncated") counts.truncated += 1;
      if (result === "reused") counts.reused += 1;
      if (result === "unsupported") counts.unsupported += 1;
      if (result === "failed") counts.failed += 1;
    } catch (error) {
      counts.deferred += 1;
      errors.push({
        closeoutId: candidate.closeoutId,
        documentVersionId: candidate.documentVersionId,
        error: errorText(error),
      });
      console.error(
        `BEACON_CLOSEOUT_ERROR closeout=${candidate.closeoutId} version=${candidate.documentVersionId} ${errorText(error)}`,
      );
    }
  }

  const summary = {
    source: SOURCE,
    agency: AGENCY_SLUG,
    completedAt: new Date().toISOString(),
    limit: CLOSEOUT_LIMIT,
    retryFailed: RETRY_FAILED_EXTRACTIONS,
    ...counts,
  };
  await writeFile(
    join(DOCUMENT_ARTIFACT_DIR, "closeout-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  await writeFile(
    join(DOCUMENT_ARTIFACT_DIR, "closeout-errors.json"),
    JSON.stringify(errors, null, 2),
    "utf8",
  );
  console.log(`BEACON_CLOSEOUT_SUMMARY ${JSON.stringify(summary)}`);
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
