import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import puppeteer from "puppeteer";

import { closeDb, getDb } from "../lib/db/client";
import {
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "../lib/db/document-extractions-schema";
import {
  opportunities,
  opportunityDocuments,
  opportunityDocumentVersions,
} from "../lib/db/schema";
import {
  extractDocumentContent,
  getDocumentExtractorDescriptor,
  type DocumentExtractorDescriptor,
} from "../lib/procurement/documents/extract-content";
import { decideExtractionQueueAction } from "../lib/procurement/documents/extraction-queue";
import {
  persistDocumentExtraction,
  persistDocumentExtractionFailure,
  reuseDocumentExtractionIfAvailable,
} from "../lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "../lib/procurement/documents/extractions";
import {
  isSupportedDocumentType,
  persistOpportunityDocumentSet,
  type PersistableDocument,
} from "../lib/procurement/documents/persistence";
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
  getBeaconSessionCookies,
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
import type { BrowserSessionEnvelope } from "../lib/source-connections/session";

const SOURCE = "beacon";
const PROVIDER = "beacon";
const BEACON_ORIGIN = "https://www.beaconbid.com";
const AGENCY_SLUG = process.env.BEACON_AGENCY ?? "city-of-houston";
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const DOCUMENT_ARTIFACT_DIR = join(ARTIFACT_DIR, "documents");
const MAX_BYTES = Number(process.env.BEACON_DOCUMENT_MAX_BYTES ?? String(300 * 1024 * 1024));
const MAX_EXTRACTION_SOURCE_BYTES = Number(
  process.env.BEACON_EXTRACTION_MAX_SOURCE_BYTES ?? String(64 * 1024 * 1024),
);
const CONCURRENCY = Math.max(1, Number(process.env.BEACON_DOCUMENT_CONCURRENCY ?? "2"));
const REQUEST_TIMEOUT_MS = Number(process.env.BEACON_DOCUMENT_TIMEOUT_MS ?? "120000");
const FORCE_REHASH = process.env.BEACON_DOCUMENT_FORCE_REHASH === "true";
const MAX_ERROR_RATE = Number(process.env.BEACON_DOCUMENT_MAX_ERROR_RATE ?? "0.25");
const AUTO_REGISTER = process.env.BEACON_AUTO_REGISTER !== "false";
const EXTRACTION_ENABLED = process.env.BEACON_DOCUMENT_EXTRACT !== "false";
const RETRY_FAILED_EXTRACTIONS = process.env.BEACON_EXTRACTION_RETRY_FAILED === "true";
const BACKFILL_LIMIT = Math.max(0, Number(process.env.BEACON_EXTRACTION_BACKFILL_LIMIT ?? "25"));
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

type RetrievalErrorKind =
  | "auth_required"
  | "registration_required"
  | "registration_failed"
  | "network"
  | "http"
  | "size";

type SkipReason =
  | "already_hashed"
  | "unsupported"
  | "too_large"
  | "registration_required"
  | "canonical_reuse"
  | "previous_failure"
  | "backfill_limit";

type ExtractionCheckpoint = "reused" | "failed" | null;
type CanonicalExtractionRow = { id: string; status: string };

class DocumentRetrievalError extends Error {
  constructor(
    message: string,
    readonly kind: RetrievalErrorKind,
  ) {
    super(message);
    this.name = "DocumentRetrievalError";
  }
}

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

interface LatestVersion {
  id: string;
  versionNumber: number;
  checksumSha256: string | null;
}

interface RetrievedDocument {
  document: PersistableDocument;
  bytesRead: number;
  attemptedDownload: boolean;
  contentBuffer?: Buffer | null;
  extractionTooLarge?: boolean;
  extractionCheckpoint?: ExtractionCheckpoint;
  usedPresignedRedirect?: boolean;
  skipReason?: SkipReason;
  error?: string;
  errorKind?: RetrievalErrorKind;
}

interface ReprocessSignal {
  opportunityId: string;
  sourceOpportunityId: string;
  documentId: string;
  documentVersionId: string;
  sourceDocumentKey: string;
  versionNumber: number;
  change: string;
  isAmendment: boolean;
  amendmentLabel: string | null;
}

interface BeaconConnection {
  cookieHeader: string;
  registrationProfile: BeaconRegistrationProfile | null;
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown Beacon document retrieval error";
}

function numberHeader(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function classifyError(error: unknown): RetrievalErrorKind {
  if (error instanceof DocumentRetrievalError) return error.kind;
  if (error instanceof TypeError) return "network";
  return "http";
}

function baseDocument(row: DocumentRow) {
  return enrichBeaconDocumentMetadata({
    sourceDocumentKey: row.sourceDocumentKey,
    sourceDocumentId: row.sourceDocumentId,
    name: row.name,
    url: row.url,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    sourceMetadata: row.sourceMetadata,
  });
}

function toPuppeteerCookies(session: BrowserSessionEnvelope) {
  return getBeaconSessionCookies(session).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...(cookie.expires ? { expires: cookie.expires } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  }));
}

async function markNeedsReauth(
  reason: "session_invalid" | "authentication_failed" | "retrieval_unauthorized",
) {
  try {
    await markSourceConnectionNeedsReauth(PROVIDER, reason);
  } catch {
    // Keep the original safe retrieval error as the operator-facing failure.
  }
}

async function validateBeaconSessionInBrowser(session: BrowserSessionEnvelope) {
  const cookies = toPuppeteerCookies(session);
  if (!cookies.some((cookie) => cookie.name === "_bs" && cookie.value)) {
    await markNeedsReauth("session_invalid");
    throw new DocumentRetrievalError(
      "Beacon source connection is missing its reusable authentication session; reconnect Beacon in govTract.",
      "auth_required",
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.setCookie(...cookies);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENT);
    await page.goto(BEACON_ORIGIN, { waitUntil: "networkidle2", timeout: 60_000 });

    if (session.localStorage && Object.keys(session.localStorage).length > 0) {
      await page.evaluate((values) => {
        window.localStorage.clear();
        for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
      }, session.localStorage);
      await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
    }

    const probe = await page.evaluate(async () => {
      const response = await fetch("/api/rest/session", { credentials: "include" });
      return { status: response.status, body: await response.text() };
    });
    const parsed = parseBeaconSessionProbe(probe.status, probe.body);
    if (!parsed.authenticatedSupplier) {
      await markNeedsReauth("authentication_failed");
      throw new DocumentRetrievalError(
        "Beacon source connection no longer has supplier access; reconnect Beacon in govTract.",
        "auth_required",
      );
    }

    return parseBeaconRegistrationProfile(probe.body);
  } catch (error) {
    if (error instanceof DocumentRetrievalError) throw error;
    await markNeedsReauth("authentication_failed");
    throw new DocumentRetrievalError(
      "Beacon source connection could not be validated; reconnect Beacon in govTract.",
      "auth_required",
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

async function loadValidatedBeaconConnection(): Promise<BeaconConnection> {
  let session: BrowserSessionEnvelope;
  try {
    session = await loadSourceConnectionSession(PROVIDER);
  } catch (error) {
    const suffix = error instanceof SourceConnectionUnavailableError ? ` (${error.reason})` : "";
    throw new DocumentRetrievalError(
      `Beacon persisted source connection is unavailable${suffix}; reconnect Beacon in govTract.`,
      "auth_required",
    );
  }

  let cookieHeader: string;
  try {
    cookieHeader = buildBeaconCookieHeader(session);
  } catch {
    await markNeedsReauth("session_invalid");
    throw new DocumentRetrievalError(
      "Beacon persisted source connection is invalid; reconnect Beacon in govTract.",
      "auth_required",
    );
  }

  const registrationProfile = await validateBeaconSessionInBrowser(session);
  await markSourceConnectionValidated(PROVIDER);
  return { cookieHeader, registrationProfile };
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
      throw new DocumentRetrievalError(
        "Refusing to send Beacon session credentials to an unexpected host",
        "http",
      );
    }
    headers.set("cookie", options.beaconCookieHeader);
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

async function registerBeaconSolicitation(input: {
  sourceOpportunityId: string;
  connection: BeaconConnection;
}) {
  if (!AUTO_REGISTER) {
    throw new DocumentRetrievalError(
      "Beacon requires solicitation registration before document retrieval.",
      "registration_required",
    );
  }
  if (!input.connection.registrationProfile) {
    throw new DocumentRetrievalError(
      "Beacon supplier profile is incomplete for automatic solicitation registration.",
      "registration_failed",
    );
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
  if (!result.ok) {
    throw new DocumentRetrievalError(
      `Beacon automatic solicitation registration failed (HTTP ${response.status}).`,
      "registration_failed",
    );
  }
}

async function resolveBeaconDownloadResponse(input: {
  downloadUrl: string;
  sourceDocumentKey: string;
  beaconCookieHeader: string;
}) {
  const gatewayResponse = await fetchWithTimeout(
    input.downloadUrl,
    { method: "GET", redirect: "manual" },
    { beaconCookieHeader: input.beaconCookieHeader },
  );

  if (gatewayResponse.status >= 300 && gatewayResponse.status < 400) {
    const location = gatewayResponse.headers.get("location");
    await gatewayResponse.body?.cancel();
    if (!location) {
      throw new DocumentRetrievalError(
        `Beacon document gateway returned HTTP ${gatewayResponse.status} without a redirect location`,
        "http",
      );
    }
    if (!isBeaconPresignedDocumentUrl({ url: location, sourceDocumentKey: input.sourceDocumentKey })) {
      throw new DocumentRetrievalError(
        `Beacon document gateway returned an unexpected redirect target (HTTP ${gatewayResponse.status})`,
        "http",
      );
    }

    const s3Response = await fetchWithTimeout(location, { method: "GET", redirect: "manual" });
    if (s3Response.status >= 300 && s3Response.status < 400) {
      await s3Response.body?.cancel();
      throw new DocumentRetrievalError(
        `Beacon presigned S3 document unexpectedly redirected again (HTTP ${s3Response.status})`,
        "http",
      );
    }
    return { response: s3Response, usedPresignedRedirect: true };
  }

  return { response: gatewayResponse, usedPresignedRedirect: false };
}

async function hashAndMaybeBufferResponse(response: Response, responseSize: number | null) {
  if (!response.body) throw new Error("Document response did not include a body");

  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let bufferable =
    EXTRACTION_ENABLED &&
    (responseSize === null || responseSize <= MAX_EXTRACTION_SOURCE_BYTES);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > MAX_BYTES) {
        await reader.cancel("govTract document size bound exceeded");
        throw new DocumentRetrievalError(
          `Document exceeded BEACON_DOCUMENT_MAX_BYTES (${MAX_BYTES} bytes) while streaming`,
          "size",
        );
      }

      hash.update(value);
      if (bufferable) {
        if (bytesRead <= MAX_EXTRACTION_SOURCE_BYTES) {
          chunks.push(Buffer.from(value));
        } else {
          chunks.length = 0;
          bufferable = false;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    checksumSha256: hash.digest("hex"),
    bytesRead,
    contentBuffer: bufferable ? Buffer.concat(chunks) : null,
    extractionTooLarge: EXTRACTION_ENABLED && !bufferable,
  };
}

async function latestVersion(documentId: string): Promise<LatestVersion | null> {
  const db = getDb();
  const [latest] = await db
    .select({
      id: opportunityDocumentVersions.id,
      versionNumber: opportunityDocumentVersions.versionNumber,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
    })
    .from(opportunityDocumentVersions)
    .where(eq(opportunityDocumentVersions.opportunityDocumentId, documentId))
    .orderBy(desc(opportunityDocumentVersions.versionNumber))
    .limit(1);
  return latest ?? null;
}

async function resolveVersionId(documentId: string, versionNumber: number) {
  const db = getDb();
  const [version] = await db
    .select({ id: opportunityDocumentVersions.id })
    .from(opportunityDocumentVersions)
    .where(
      and(
        eq(opportunityDocumentVersions.opportunityDocumentId, documentId),
        eq(opportunityDocumentVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (!version) throw new Error("Persisted document version could not be resolved");
  return version.id;
}

async function findCanonicalExtraction(
  checksumSha256: string,
  descriptor: DocumentExtractorDescriptor,
): Promise<CanonicalExtractionRow | null> {
  const db = getDb();
  const rows = await db
    .select({ id: documentExtractions.id, status: documentExtractions.status })
    .from(documentExtractions)
    .where(
      and(
        eq(documentExtractions.checksumSha256, checksumSha256.toLowerCase()),
        eq(documentExtractions.extractorName, descriptor.extractorName),
        eq(documentExtractions.extractorVersion, descriptor.extractorVersion),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function attachExistingExtraction(extractionId: string, documentVersionId: string) {
  const db = getDb();
  await db
    .insert(opportunityDocumentVersionExtractions)
    .values({
      opportunityDocumentVersionId: documentVersionId,
      documentExtractionId: extractionId,
    })
    .onConflictDoNothing();
}

async function retrieveDocument(input: {
  row: DocumentRow;
  getBeaconConnection: () => Promise<BeaconConnection>;
  ensureRegistration: (sourceOpportunityId: string) => Promise<void>;
  claimBackfillSlot: () => boolean;
  backfillSlotsRemaining: () => number;
}): Promise<RetrievedDocument> {
  const { row } = input;
  const base = baseDocument(row);
  if (!isSupportedDocumentType(base)) {
    return { document: base, bytesRead: 0, attemptedDownload: false, skipReason: "unsupported" };
  }
  if (base.fileSizeBytes && base.fileSizeBytes > MAX_BYTES) {
    return { document: base, bytesRead: 0, attemptedDownload: false, skipReason: "too_large" };
  }

  const descriptor = getDocumentExtractorDescriptor(base);
  const latest = await latestVersion(row.documentId);
  let existingExtraction: CanonicalExtractionRow | null = null;
  if (EXTRACTION_ENABLED && latest?.checksumSha256 && descriptor) {
    existingExtraction = await findCanonicalExtraction(latest.checksumSha256, descriptor);
  }

  const queueDecision = decideExtractionQueueAction({
    extractionEnabled: EXTRACTION_ENABLED,
    checksumSha256: latest?.checksumSha256 ?? null,
    existingStatus:
      existingExtraction?.status === "pending" ||
      existingExtraction?.status === "extracted" ||
      existingExtraction?.status === "failed" ||
      existingExtraction?.status === "truncated"
        ? existingExtraction.status
        : null,
    retryFailed: RETRY_FAILED_EXTRACTIONS,
    backfillSlotsRemaining: input.backfillSlotsRemaining(),
    forceRehash: FORCE_REHASH,
  });

  if (queueDecision.attachExisting && existingExtraction && latest) {
    await attachExistingExtraction(existingExtraction.id, latest.id);
    return {
      document: base,
      bytesRead: 0,
      attemptedDownload: false,
      extractionCheckpoint:
        existingExtraction.status === "failed" ? "failed" : "reused",
      skipReason:
        existingExtraction.status === "failed" ? "previous_failure" : "canonical_reuse",
    };
  }

  if (!queueDecision.download) {
    return {
      document: base,
      bytesRead: 0,
      attemptedDownload: false,
      skipReason:
        queueDecision.reason === "backfill_limit" ? "backfill_limit" : "already_hashed",
    };
  }

  if (queueDecision.consumesBackfillSlot && !input.claimBackfillSlot()) {
    return {
      document: base,
      bytesRead: 0,
      attemptedDownload: false,
      skipReason: "backfill_limit",
    };
  }

  if (
    EXTRACTION_ENABLED &&
    latest?.checksumSha256 &&
    descriptor &&
    !FORCE_REHASH &&
    base.fileSizeBytes &&
    base.fileSizeBytes > MAX_EXTRACTION_SOURCE_BYTES
  ) {
    await persistDocumentExtractionFailure({
      documentVersionIds: [latest.id],
      checksumSha256: latest.checksumSha256,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
      sourceMimeType: base.mimeType,
      sourceByteCount: base.fileSizeBytes,
      failureCode: "source_too_large",
      metadata: { source: SOURCE },
    });
    return {
      document: base,
      bytesRead: 0,
      attemptedDownload: false,
      extractionCheckpoint: "failed",
      skipReason: "previous_failure",
    };
  }

  const downloadUrl = resolveBeaconDocumentDownloadUrl({
    sourceOpportunityId: row.sourceOpportunityId,
    sourceDocumentKey: row.sourceDocumentKey,
  });
  if (!downloadUrl) {
    throw new DocumentRetrievalError("Could not build Beacon planholder document route", "http");
  }

  const connection = await input.getBeaconConnection();
  let response: Response;
  let usedPresignedRedirect = false;
  let registrationRetried = false;

  while (true) {
    try {
      const resolved = await resolveBeaconDownloadResponse({
        downloadUrl,
        sourceDocumentKey: row.sourceDocumentKey,
        beaconCookieHeader: connection.cookieHeader,
      });
      response = resolved.response;
      usedPresignedRedirect = usedPresignedRedirect || resolved.usedPresignedRedirect;
    } catch (error) {
      if (error instanceof DocumentRetrievalError) throw error;
      throw new DocumentRetrievalError("Beacon document request failed", "network");
    }

    if (response.ok) break;
    const body = (await response.text()).slice(0, 1000);
    if (isBeaconRegistrationRequiredResponse(response.status, body)) {
      if (!AUTO_REGISTER) {
        throw new DocumentRetrievalError(
          "Beacon requires solicitation registration before document retrieval.",
          "registration_required",
        );
      }
      if (registrationRetried) {
        throw new DocumentRetrievalError(
          "Beacon still requires registration after automatic solicitation registration.",
          "registration_failed",
        );
      }
      await input.ensureRegistration(row.sourceOpportunityId);
      registrationRetried = true;
      continue;
    }
    if (isBeaconPermissionResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        `Beacon denied supplier document access (HTTP ${response.status}); reconnect Beacon in govTract.`,
        "auth_required",
      );
    }
    throw new DocumentRetrievalError(`Beacon document returned HTTP ${response.status}`, "http");
  }

  const responseSize = numberHeader(response.headers.get("content-length"));
  if (responseSize && responseSize > MAX_BYTES) {
    await response.body?.cancel();
    throw new DocumentRetrievalError(
      `Beacon document reports ${responseSize} bytes, above BEACON_DOCUMENT_MAX_BYTES=${MAX_BYTES}`,
      "size",
    );
  }

  const streamed = await hashAndMaybeBufferResponse(response, responseSize);
  const responseMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;
  return {
    document: {
      ...base,
      mimeType: base.mimeType ?? responseMimeType,
      fileSizeBytes: base.fileSizeBytes ?? responseSize ?? streamed.bytesRead,
      checksumSha256: streamed.checksumSha256,
      retrievedAt: new Date(),
      storageMode: "source",
      contentPersisted: false,
    },
    bytesRead: streamed.bytesRead,
    attemptedDownload: true,
    contentBuffer: streamed.contentBuffer,
    extractionTooLarge: streamed.extractionTooLarge,
    usedPresignedRedirect,
  };
}

async function processExtraction(input: {
  result: RetrievedDocument;
  documentVersionId: string;
}) {
  const checksumSha256 = input.result.document.checksumSha256;
  if (!EXTRACTION_ENABLED || !checksumSha256) return { status: "skipped" as const, bytes: 0 };

  const descriptor = getDocumentExtractorDescriptor(input.result.document);
  if (!descriptor) return { status: "skipped" as const, bytes: 0 };

  const reused = await reuseDocumentExtractionIfAvailable({
    documentVersionIds: [input.documentVersionId],
    checksumSha256,
    extractorName: descriptor.extractorName,
    extractorVersion: descriptor.extractorVersion,
  });
  if (reused) return { status: "reused" as const, bytes: 0 };

  if (input.result.extractionTooLarge || !input.result.contentBuffer) {
    await persistDocumentExtractionFailure({
      documentVersionIds: [input.documentVersionId],
      checksumSha256,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
      sourceMimeType: input.result.document.mimeType,
      sourceByteCount: input.result.document.fileSizeBytes ?? input.result.bytesRead,
      failureCode: input.result.extractionTooLarge ? "source_too_large" : "source_bytes_unavailable",
      metadata: { source: SOURCE },
    });
    return { status: "failed" as const, bytes: 0 };
  }

  try {
    const extracted = await extractDocumentContent({
      name: input.result.document.name,
      mimeType: input.result.document.mimeType,
      buffer: input.result.contentBuffer,
    });
    const prepared = prepareExtractionSegments(extracted.segments);
    const persisted = await persistDocumentExtraction({
      documentVersionIds: [input.documentVersionId],
      checksumSha256,
      extractorName: extracted.extractorName,
      extractorVersion: extracted.extractorVersion,
      sourceMimeType: input.result.document.mimeType,
      sourceByteCount: input.result.document.fileSizeBytes ?? input.result.bytesRead,
      metadata: { source: SOURCE, ...extracted.metadata },
      prepared,
    });
    return {
      status: persisted.reused
        ? ("reused" as const)
        : persisted.status === "truncated"
          ? ("truncated" as const)
          : ("extracted" as const),
      bytes: persisted.reused ? 0 : prepared.extractedByteCount,
    };
  } catch {
    await persistDocumentExtractionFailure({
      documentVersionIds: [input.documentVersionId],
      checksumSha256,
      extractorName: descriptor.extractorName,
      extractorVersion: descriptor.extractorVersion,
      sourceMimeType: input.result.document.mimeType,
      sourceByteCount: input.result.document.fileSizeBytes ?? input.result.bytesRead,
      failureCode: "extractor_error",
      metadata: { source: SOURCE },
    });
    return { status: "failed" as const, bytes: 0 };
  }
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
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Beacon document ingestion");
  if (!process.env.SOURCE_SESSION_ENCRYPTION_KEY) {
    throw new Error(
      "SOURCE_SESSION_ENCRYPTION_KEY is required to load the persisted Beacon source connection",
    );
  }
  if (!Number.isFinite(MAX_EXTRACTION_SOURCE_BYTES) || MAX_EXTRACTION_SOURCE_BYTES <= 0) {
    throw new Error("BEACON_EXTRACTION_MAX_SOURCE_BYTES must be a positive number");
  }
  if (!Number.isFinite(BACKFILL_LIMIT)) {
    throw new Error("BEACON_EXTRACTION_BACKFILL_LIMIT must be a number");
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

  let beaconConnectionPromise: Promise<BeaconConnection> | null = null;
  let sourceConnectionValidationAttempted = false;
  const getBeaconConnection = () => {
    sourceConnectionValidationAttempted = true;
    beaconConnectionPromise ??= loadValidatedBeaconConnection();
    return beaconConnectionPromise;
  };

  const registrationPromises = new Map<string, Promise<void>>();
  const autoRegisteredSourceOpportunities = new Set<string>();
  const ensureRegistration = (sourceOpportunityId: string) => {
    const existing = registrationPromises.get(sourceOpportunityId);
    if (existing) return existing;
    const promise = (async () => {
      const connection = await getBeaconConnection();
      await registerBeaconSolicitation({ sourceOpportunityId, connection });
      autoRegisteredSourceOpportunities.add(sourceOpportunityId);
      console.log(
        `BEACON_PLANHOLDER_REGISTERED sourceOpportunity=${sourceOpportunityId} interest=Bidder emailDocument=false`,
      );
    })();
    registrationPromises.set(sourceOpportunityId, promise);
    return promise;
  };

  let backfillClaimed = 0;
  const claimBackfillSlot = () => {
    if (backfillClaimed >= BACKFILL_LIMIT) return false;
    backfillClaimed += 1;
    return true;
  };
  const backfillSlotsRemaining = () => Math.max(0, BACKFILL_LIMIT - backfillClaimed);

  const reprocess: ReprocessSignal[] = [];
  const errors: Array<{
    opportunityId: string;
    sourceDocumentKey: string;
    stage: "retrieval" | "extraction";
    kind: string;
  }> = [];
  const registrationRequiredOpportunities = new Set<string>();
  let attemptedDownloads = 0;
  let downloaded = 0;
  let bytesRead = 0;
  let processedDocuments = 0;
  let presignedRedirectCount = 0;
  let retrievalErrorCount = 0;
  let authRequiredCount = 0;
  let registrationRequiredAttemptCount = 0;
  let skippedAlreadyHashed = 0;
  let skippedUnsupported = 0;
  let skippedTooLarge = 0;
  let extractionPendingCount = 0;
  let extractionExtractedCount = 0;
  let extractionTruncatedCount = 0;
  let extractionReusedCount = 0;
  let extractionFailedCount = 0;
  let extractionSkippedCount = 0;
  let extractedBytesWritten = 0;

  for (const [opportunityId, documents] of byOpportunity) {
    let registrationRequired = false;
    const retrieved = await mapConcurrent(documents, CONCURRENCY, async (row) => {
      if (registrationRequired) {
        return {
          document: baseDocument(row),
          bytesRead: 0,
          attemptedDownload: false,
          skipReason: "registration_required",
          errorKind: "registration_required",
        } satisfies RetrievedDocument;
      }

      try {
        return await retrieveDocument({
          row,
          getBeaconConnection,
          ensureRegistration,
          claimBackfillSlot,
          backfillSlotsRemaining,
        });
      } catch (error) {
        const kind = classifyError(error);
        if (kind === "registration_required") {
          registrationRequired = true;
          registrationRequiredOpportunities.add(opportunityId);
          registrationRequiredAttemptCount += 1;
          return {
            document: baseDocument(row),
            bytesRead: 0,
            attemptedDownload: true,
            skipReason: "registration_required",
            errorKind: kind,
          } satisfies RetrievedDocument;
        }
        retrievalErrorCount += 1;
        if (kind === "auth_required") authRequiredCount += 1;
        errors.push({
          opportunityId,
          sourceDocumentKey: row.sourceDocumentKey,
          stage: "retrieval",
          kind,
        });
        console.error(
          `BEACON_DOCUMENT_ERROR stage=retrieval kind=${kind} opportunity=${opportunityId} key=${row.sourceDocumentKey}`,
        );
        return {
          document: baseDocument(row),
          bytesRead: 0,
          attemptedDownload: true,
          error: errorText(error),
          errorKind: kind,
        } satisfies RetrievedDocument;
      }
    });

    const persistenceResults = await persistOpportunityDocumentSet({
      opportunityId,
      documents: retrieved.map((result) => result.document),
    });
    const retrievedByKey = new Map(retrieved.map((result) => [result.document.sourceDocumentKey, result]));
    const sourceOpportunityId = documents[0]?.sourceOpportunityId ?? opportunityId;

    for (const result of retrieved) {
      processedDocuments += 1;
      bytesRead += result.bytesRead;
      if (result.attemptedDownload) attemptedDownloads += 1;
      if (result.attemptedDownload && !result.error) downloaded += 1;
      if (result.usedPresignedRedirect) presignedRedirectCount += 1;
      if (result.skipReason === "already_hashed") skippedAlreadyHashed += 1;
      if (result.skipReason === "unsupported") skippedUnsupported += 1;
      if (result.skipReason === "too_large") skippedTooLarge += 1;
      if (result.skipReason === "backfill_limit") extractionPendingCount += 1;
      if (result.extractionCheckpoint === "reused") extractionReusedCount += 1;
      if (result.extractionCheckpoint === "failed") extractionFailedCount += 1;
    }

    for (const persisted of persistenceResults) {
      const retrievedResult = retrievedByKey.get(persisted.sourceDocumentKey);
      if (!retrievedResult) continue;
      const documentVersionId = await resolveVersionId(persisted.documentId, persisted.versionNumber);

      if (persisted.requiresProcessing) {
        reprocess.push({
          opportunityId,
          sourceOpportunityId,
          documentId: persisted.documentId,
          documentVersionId,
          sourceDocumentKey: persisted.sourceDocumentKey,
          versionNumber: persisted.versionNumber,
          change: persisted.change,
          isAmendment: retrievedResult.document.isAmendment ?? false,
          amendmentLabel: retrievedResult.document.amendmentLabel ?? null,
        });
      }

      if (!EXTRACTION_ENABLED || retrievedResult.extractionCheckpoint) continue;
      if (retrievedResult.skipReason === "unsupported") {
        extractionSkippedCount += 1;
        continue;
      }
      if (retrievedResult.skipReason === "backfill_limit") continue;
      if (!retrievedResult.document.checksumSha256) continue;

      try {
        const extraction = await processExtraction({
          result: retrievedResult,
          documentVersionId,
        });
        if (extraction.status === "extracted") extractionExtractedCount += 1;
        if (extraction.status === "truncated") extractionTruncatedCount += 1;
        if (extraction.status === "reused") extractionReusedCount += 1;
        if (extraction.status === "failed") extractionFailedCount += 1;
        if (extraction.status === "skipped") extractionSkippedCount += 1;
        extractedBytesWritten += extraction.bytes;
      } catch {
        extractionFailedCount += 1;
        errors.push({
          opportunityId,
          sourceDocumentKey: persisted.sourceDocumentKey,
          stage: "extraction",
          kind: "persistence_error",
        });
        console.error(
          `BEACON_DOCUMENT_ERROR stage=extraction kind=persistence_error opportunity=${opportunityId} key=${persisted.sourceDocumentKey}`,
        );
      }
    }
  }

  if (authRequiredCount > 0) await markNeedsReauth("retrieval_unauthorized");

  const effectiveAttemptedDownloads = Math.max(0, attemptedDownloads - registrationRequiredAttemptCount);
  const errorRate = effectiveAttemptedDownloads > 0 ? retrievalErrorCount / effectiveAttemptedDownloads : 0;
  const summary = {
    source: SOURCE,
    agency: AGENCY_SLUG,
    completedAt: new Date().toISOString(),
    opportunityCount: byOpportunity.size,
    documentCount: rows.length,
    processedDocuments,
    attemptedDownloads,
    effectiveAttemptedDownloads,
    downloaded,
    presignedRedirectCount,
    bytesRead,
    skippedAlreadyHashed,
    skippedUnsupported,
    skippedTooLarge,
    registrationRequiredOpportunityCount: registrationRequiredOpportunities.size,
    autoRegister: AUTO_REGISTER,
    autoRegisteredOpportunityCount: autoRegisteredSourceOpportunities.size,
    retrievalErrorCount,
    authRequiredCount,
    errorRate,
    maxErrorRate: MAX_ERROR_RATE,
    reprocessCount: reprocess.length,
    extraction: {
      enabled: EXTRACTION_ENABLED,
      backfillLimit: BACKFILL_LIMIT,
      backfillClaimed,
      pending: extractionPendingCount,
      extracted: extractionExtractedCount,
      truncated: extractionTruncatedCount,
      reused: extractionReusedCount,
      failed: extractionFailedCount,
      skipped: extractionSkippedCount,
      extractedBytesWritten,
      maxSourceBytes: MAX_EXTRACTION_SOURCE_BYTES,
      retryFailed: RETRY_FAILED_EXTRACTIONS,
    },
    maxBytes: MAX_BYTES,
    concurrency: CONCURRENCY,
    forceRehash: FORCE_REHASH,
    sourceConnectionMode: "persisted",
    sourceConnectionValidationAttempted,
  };

  await writeFile(join(DOCUMENT_ARTIFACT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(join(DOCUMENT_ARTIFACT_DIR, "reprocess.json"), JSON.stringify(reprocess, null, 2), "utf8");
  await writeFile(join(DOCUMENT_ARTIFACT_DIR, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  console.log(`BEACON_DOCUMENT_SUMMARY ${JSON.stringify(summary)}`);

  if (authRequiredCount > 0) {
    throw new Error(
      `Beacon source connection requires reauthentication for ${authRequiredCount} attempted document(s). Reconnect Beacon in govTract and rerun document retrieval.`,
    );
  }
  if (effectiveAttemptedDownloads > 0 && downloaded === 0 && retrievalErrorCount > 0) {
    throw new Error(
      `Beacon document retrieval failed systemically: 0/${effectiveAttemptedDownloads} non-registration download attempts succeeded. See documents/errors.json.`,
    );
  }
  if (effectiveAttemptedDownloads > 0 && errorRate > MAX_ERROR_RATE) {
    throw new Error(
      `Beacon document retrieval error rate ${(errorRate * 100).toFixed(1)}% exceeded BEACON_DOCUMENT_MAX_ERROR_RATE=${MAX_ERROR_RATE}. See documents/errors.json.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
