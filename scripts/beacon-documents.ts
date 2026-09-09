import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import puppeteer from "puppeteer";

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
import {
  enrichBeaconDocumentMetadata,
  isBeaconPresignedDocumentUrl,
  resolveBeaconDocumentDownloadUrl,
} from "../lib/procurement/sources/beacon/documents";
import {
  buildBeaconCookieHeader,
  getBeaconSessionCookies,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
  parseBeaconSessionProbe,
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
const CONCURRENCY = Math.max(1, Number(process.env.BEACON_DOCUMENT_CONCURRENCY ?? "4"));
const REQUEST_TIMEOUT_MS = Number(process.env.BEACON_DOCUMENT_TIMEOUT_MS ?? "120000");
const FORCE_REHASH = process.env.BEACON_DOCUMENT_FORCE_REHASH === "true";
const MAX_ERROR_RATE = Number(process.env.BEACON_DOCUMENT_MAX_ERROR_RATE ?? "0.25");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

type RetrievalErrorKind =
  | "auth_required"
  | "registration_required"
  | "network"
  | "http"
  | "size";
type SkipReason = "already_hashed" | "unsupported" | "too_large" | "registration_required";

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

interface RetrievedDocument {
  document: PersistableDocument;
  bytesRead: number;
  attemptedDownload: boolean;
  usedPresignedRedirect?: boolean;
  skipReason?: SkipReason;
  error?: string;
  errorKind?: RetrievalErrorKind;
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

async function markNeedsReauth(reason: "session_invalid" | "authentication_failed" | "retrieval_unauthorized") {
  try {
    await markSourceConnectionNeedsReauth(PROVIDER, reason);
  } catch {
    // Retrieval will still fail. Do not replace the safe retrieval error with a DB detail.
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

async function loadValidatedBeaconCookieHeader() {
  let session: BrowserSessionEnvelope;

  try {
    session = await loadSourceConnectionSession(PROVIDER);
  } catch (error) {
    const suffix =
      error instanceof SourceConnectionUnavailableError
        ? ` (${error.reason})`
        : "";
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

  await validateBeaconSessionInBrowser(session);
  await markSourceConnectionValidated(PROVIDER);
  return cookieHeader;
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
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timer);
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

    if (
      !isBeaconPresignedDocumentUrl({
        url: location,
        sourceDocumentKey: input.sourceDocumentKey,
      })
    ) {
      throw new DocumentRetrievalError(
        `Beacon document gateway returned an unexpected redirect target (HTTP ${gatewayResponse.status})`,
        "http",
      );
    }

    // The signed S3 URL is consumed immediately and never logged or persisted. Critically,
    // the Beacon Cookie header is omitted from this request.
    const s3Response = await fetchWithTimeout(location, {
      method: "GET",
      redirect: "manual",
    });

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
        throw new DocumentRetrievalError(
          `Document exceeded BEACON_DOCUMENT_MAX_BYTES (${MAX_BYTES} bytes) while streaming`,
          "size",
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

async function retrieveDocument(
  row: DocumentRow,
  getBeaconCookieHeader: () => Promise<string>,
): Promise<RetrievedDocument> {
  const base = baseDocument(row);

  if (!isSupportedDocumentType(base)) {
    return { document: base, bytesRead: 0, attemptedDownload: false, skipReason: "unsupported" };
  }

  if (base.fileSizeBytes && base.fileSizeBytes > MAX_BYTES) {
    return { document: base, bytesRead: 0, attemptedDownload: false, skipReason: "too_large" };
  }

  const checksum = await latestChecksum(row.documentId);
  if (checksum && !FORCE_REHASH) {
    return { document: base, bytesRead: 0, attemptedDownload: false, skipReason: "already_hashed" };
  }

  const downloadUrl = resolveBeaconDocumentDownloadUrl({
    sourceOpportunityId: row.sourceOpportunityId,
    sourceDocumentKey: row.sourceDocumentKey,
  });
  if (!downloadUrl) {
    throw new DocumentRetrievalError("Could not build Beacon planholder document route", "http");
  }

  const beaconCookieHeader = await getBeaconCookieHeader();
  let response: Response;
  let usedPresignedRedirect = false;

  try {
    const resolved = await resolveBeaconDownloadResponse({
      downloadUrl,
      sourceDocumentKey: row.sourceDocumentKey,
      beaconCookieHeader,
    });
    response = resolved.response;
    usedPresignedRedirect = resolved.usedPresignedRedirect;
  } catch (error) {
    if (error instanceof DocumentRetrievalError) throw error;
    throw new DocumentRetrievalError("Beacon document request failed", "network");
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    if (isBeaconRegistrationRequiredResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        "Beacon requires solicitation registration before document retrieval.",
        "registration_required",
      );
    }
    if (isBeaconPermissionResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        `Beacon denied supplier document access (HTTP ${response.status}); reconnect Beacon in govTract.`,
        "auth_required",
      );
    }
    throw new DocumentRetrievalError(
      `Beacon document returned HTTP ${response.status}`,
      "http",
    );
  }

  const responseSize = numberHeader(response.headers.get("content-length"));
  if (responseSize && responseSize > MAX_BYTES) {
    await response.body?.cancel();
    throw new DocumentRetrievalError(
      `Beacon document reports ${responseSize} bytes, above BEACON_DOCUMENT_MAX_BYTES=${MAX_BYTES}`,
      "size",
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
    attemptedDownload: true,
    usedPresignedRedirect,
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
  if (!process.env.SOURCE_SESSION_ENCRYPTION_KEY) {
    throw new Error(
      "SOURCE_SESSION_ENCRYPTION_KEY is required to load the persisted Beacon source connection",
    );
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

  let beaconCookieHeaderPromise: Promise<string> | null = null;
  let sourceConnectionValidationAttempted = false;
  const getBeaconCookieHeader = () => {
    sourceConnectionValidationAttempted = true;
    beaconCookieHeaderPromise ??= loadValidatedBeaconCookieHeader();
    return beaconCookieHeaderPromise;
  };

  const reprocess: ReprocessSignal[] = [];
  const errors: Array<{
    opportunityId: string;
    sourceDocumentKey: string;
    kind: RetrievalErrorKind;
    error: string;
  }> = [];
  const registrationRequiredOpportunities = new Set<string>();
  let downloaded = 0;
  let attemptedDownloads = 0;
  let presignedRedirectCount = 0;
  let bytesRead = 0;
  let processedDocuments = 0;
  let skippedAlreadyHashed = 0;
  let skippedUnsupported = 0;
  let skippedTooLarge = 0;
  let registrationRequiredDocumentCount = 0;
  let registrationRequiredAttemptCount = 0;
  let authRequiredCount = 0;

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
        return await retrieveDocument(row, getBeaconCookieHeader);
      } catch (error) {
        const message = errorText(error);
        const kind = classifyError(error);

        if (kind === "registration_required") {
          registrationRequired = true;
          registrationRequiredOpportunities.add(opportunityId);
          return {
            document: baseDocument(row),
            bytesRead: 0,
            attemptedDownload: true,
            skipReason: "registration_required",
            error: message,
            errorKind: kind,
          } satisfies RetrievedDocument;
        }

        errors.push({ opportunityId, sourceDocumentKey: row.sourceDocumentKey, kind, error: message });
        return {
          document: baseDocument(row),
          bytesRead: 0,
          attemptedDownload: true,
          error: message,
          errorKind: kind,
        } satisfies RetrievedDocument;
      }
    });

    if (registrationRequired) {
      console.warn(
        `BEACON_DOCUMENT_REGISTRATION_REQUIRED opportunity=${opportunityId} sourceOpportunity=${documents[0]?.sourceOpportunityId ?? "unknown"}`,
      );
    }

    for (const result of retrieved) {
      processedDocuments += 1;
      bytesRead += result.bytesRead;
      if (result.attemptedDownload) attemptedDownloads += 1;
      if (result.attemptedDownload && !result.error) downloaded += 1;
      if (result.usedPresignedRedirect) presignedRedirectCount += 1;
      if (result.skipReason === "already_hashed") skippedAlreadyHashed += 1;
      if (result.skipReason === "unsupported") skippedUnsupported += 1;
      if (result.skipReason === "too_large") skippedTooLarge += 1;
      if (result.skipReason === "registration_required") registrationRequiredDocumentCount += 1;
      if (result.errorKind === "registration_required" && result.attemptedDownload) {
        registrationRequiredAttemptCount += 1;
      }
      if (result.errorKind === "auth_required") authRequiredCount += 1;
      if (result.error && result.errorKind !== "registration_required") {
        console.error(
          `BEACON_DOCUMENT_ERROR kind=${result.errorKind ?? "unknown"} opportunity=${opportunityId} key=${result.document.sourceDocumentKey} ${result.error}`,
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

  if (authRequiredCount > 0) {
    await markNeedsReauth("retrieval_unauthorized");
  }

  const retrievalErrorCount = errors.length;
  const effectiveAttemptedDownloads = Math.max(
    0,
    attemptedDownloads - registrationRequiredAttemptCount,
  );
  const errorRate =
    effectiveAttemptedDownloads > 0 ? retrievalErrorCount / effectiveAttemptedDownloads : 0;
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
    registrationRequiredDocumentCount,
    registrationRequiredAttemptCount,
    partialDocumentAccess: registrationRequiredOpportunities.size > 0,
    retrievalErrorCount,
    authRequiredCount,
    errorRate,
    maxErrorRate: MAX_ERROR_RATE,
    reprocessCount: reprocess.length,
    maxBytes: MAX_BYTES,
    concurrency: CONCURRENCY,
    forceRehash: FORCE_REHASH,
    sourceConnectionMode: "persisted",
    sourceConnectionValidationAttempted,
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

  if (authRequiredCount > 0) {
    throw new Error(
      `Beacon source connection requires reauthentication for ${authRequiredCount} attempted document(s). Reconnect Beacon in govTract and rerun document retrieval.`,
    );
  }

  if (
    effectiveAttemptedDownloads > 0 &&
    downloaded === 0 &&
    retrievalErrorCount > 0
  ) {
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
