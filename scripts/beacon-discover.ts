import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer, { type HTTPResponse, type Page } from "puppeteer";
import {
  closeDb,
  finishIngestionRun,
  persistNormalizedOpportunity,
  persistRawIngestionPage,
  persistSourceRecord,
  reconcileCompleteScope,
  recordIngestionRecordError,
  recordPagePersistenceCounts,
  startIngestionRun,
  type PagePersistenceCounts,
  type SourceRecordChange,
} from "../lib/procurement/ingestion/persistence";
import {
  normalizeBeaconSolicitation,
  toBeaconSourceRecord,
  type BeaconDate,
  type BeaconSolicitation,
} from "../lib/procurement/sources/beacon/normalize";

const SOURCE = "beacon";
const SCOPE = "open";
const AGENCY_SLUG = process.env.BEACON_AGENCY ?? "city-of-houston";
const START_URL =
  process.env.BEACON_START_URL ??
  "https://www.beaconbid.com/solicitations/city-of-houston/open";
const MAX_PAGES = Number(process.env.BEACON_MAX_PAGES ?? "100");
const PAGE_SIZE_OVERRIDE = Number(process.env.BEACON_PAGE_SIZE ?? "0");
const PERSIST = process.env.BEACON_PERSIST === "true";
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const RESPONSE_BODY_LIMIT = Number(
  process.env.BEACON_RESPONSE_BODY_LIMIT ?? String(2 * 1024 * 1024),
);

const solicitationPathPattern =
  /^\/solicitations\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

interface ListSolicitationsResponse {
  data?: {
    solicitations?: {
      total?: number;
      data?: BeaconSolicitation[];
    };
  };
  errors?: unknown;
}

interface GraphQlPayload {
  operationName?: string;
  variables: Record<string, unknown>;
  query: string;
}

interface SolicitationRecord {
  sourceId: string;
  revisionId?: string;
  refnum?: string;
  title: string;
  status?: string;
  sourceStatus?: string;
  type?: string;
  publishedAt?: string;
  modifiedAt?: string;
  issueDate?: BeaconDate;
  dueDate?: BeaconDate;
  departments?: string[];
  url: string;
  page: number;
}

interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  contentType: string;
  postData?: string;
  bodyFile?: string;
  bodyError?: string;
}

interface RunSummary {
  source: "beacon";
  agency: string;
  startUrl: string;
  startedAt: string;
  completedAt: string;
  status: "complete" | "partial" | "failed";
  pagesVisited: number;
  discoveredPageSize: number;
  pageSize: number;
  reportedTotal: number | null;
  sourceRecordCount: number;
  solicitationCount: number;
  recordErrorCount: number;
  paginationComplete: boolean;
  normalizationComplete: boolean;
  networkCandidateCount: number;
  paginationMethod: "graphql-offset";
  terminalReason: string;
  persisted: boolean;
  ingestionRunId?: string;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  error?: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const sensitive = /token|auth|signature|session|secret|password|email|key/i;

    for (const key of url.searchParams.keys()) {
      if (sensitive.test(key)) url.searchParams.set(key, "[REDACTED]");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function waitForSettled(page: Page) {
  await page
    .waitForNetworkIdle({ idleTime: 750, timeout: 10_000 })
    .catch(() => undefined);
  await delay(500);
}

async function extractCanonicalUrls(page: Page) {
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => anchor.href)
      .filter((href) => href.includes("/solicitations/")),
  );

  const urls = new Map<string, string>();
  for (const href of links) {
    try {
      const url = new URL(href);
      const match = url.pathname.match(solicitationPathPattern);
      if (match) urls.set(match[1].toLowerCase(), `${url.origin}${url.pathname}`);
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return urls;
}

async function captureResponse(
  response: HTTPResponse,
  network: NetworkEntry[],
  responseDirectory: string,
) {
  const request = response.request();
  const resourceType = request.resourceType();
  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";
  const interesting =
    resourceType === "xhr" ||
    resourceType === "fetch" ||
    contentType.includes("application/json");

  if (!interesting) return;

  const postData = request.postData();
  const entry: NetworkEntry = {
    url: redactUrl(response.url()),
    method: request.method(),
    status: response.status(),
    resourceType,
    contentType,
    ...(postData ? { postData: postData.slice(0, RESPONSE_BODY_LIMIT) } : {}),
  };
  const index = network.push(entry) - 1;

  if (
    !contentType.includes("json") &&
    !contentType.startsWith("text/") &&
    !contentType.includes("javascript")
  ) {
    return;
  }

  try {
    const body = await response.text();
    const boundedBody = body.slice(0, RESPONSE_BODY_LIMIT);
    const extension = contentType.includes("json") ? "json" : "txt";
    const bodyFile = `${String(index).padStart(4, "0")}.${extension}`;
    await writeFile(join(responseDirectory, bodyFile), boundedBody, "utf8");
    entry.bodyFile = `network/responses/${bodyFile}`;
  } catch (error) {
    entry.bodyError = error instanceof Error ? error.message : String(error);
  }
}

function findListSolicitationsRequest(network: NetworkEntry[]) {
  for (const entry of network) {
    if (!entry.url.includes("operation=ListSolicitations") || !entry.postData) continue;

    try {
      const payload = JSON.parse(entry.postData) as GraphQlPayload;
      if (
        payload.operationName === "ListSolicitations" &&
        payload.variables &&
        typeof payload.query === "string"
      ) {
        return { endpoint: entry.url, payload };
      }
    } catch {
      // Keep looking for another valid ListSolicitations request.
    }
  }

  return null;
}

async function fetchGraphQlPage(
  page: Page,
  endpoint: string,
  template: GraphQlPayload,
  start: number,
  pageSize: number,
) {
  const payload: GraphQlPayload = {
    ...template,
    variables: { ...template.variables, start, pageSize },
  };

  const result = await page.evaluate(
    async ({ requestUrl, requestBody }) => {
      const response = await fetch(requestUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      return { ok: response.ok, status: response.status, body: await response.text() };
    },
    { requestUrl: endpoint, requestBody: payload },
  );

  if (!result.ok) {
    throw new Error(
      `Beacon ListSolicitations returned HTTP ${result.status} for start=${start}`,
    );
  }

  const parsed = JSON.parse(result.body) as ListSolicitationsResponse;
  if (parsed.errors) {
    throw new Error(
      `Beacon ListSolicitations returned GraphQL errors for start=${start}: ${JSON.stringify(parsed.errors)}`,
    );
  }

  const list = parsed.data?.solicitations;
  if (!list || !Array.isArray(list.data) || typeof list.total !== "number") {
    throw new Error(`Beacon ListSolicitations response shape changed for start=${start}`);
  }

  return { parsed, total: list.total, rows: list.data };
}

function incrementCount(counts: PagePersistenceCounts, change: SourceRecordChange) {
  counts[change] += 1;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function main() {
  const startedAt = new Date().toISOString();
  const networkDirectory = join(ARTIFACT_DIR, "network");
  const responseDirectory = join(networkDirectory, "responses");
  const rawPageDirectory = join(ARTIFACT_DIR, "raw-pages");
  await mkdir(responseDirectory, { recursive: true });
  await mkdir(rawPageDirectory, { recursive: true });

  const network: NetworkEntry[] = [];
  const pendingCaptures = new Set<Promise<void>>();
  const solicitations = new Map<string, SolicitationRecord>();
  const seenSourceIds = new Set<string>();
  const seenPageSignatures = new Set<string>();
  const persistenceCounts: PagePersistenceCounts = { inserted: 0, updated: 0, unchanged: 0 };
  let ingestionRunId: string | null = null;
  let pagesVisited = 0;
  let reportedTotal: number | null = null;
  let discoveredPageSize = 50;
  let pageSize = 50;
  let lastCheckpoint: Record<string, unknown> = { start: 0, pageSize: 50 };
  let terminalReason = "unknown";
  let status: RunSummary["status"] = "failed";
  let runError: string | undefined;
  let recordErrorCount = 0;
  let paginationComplete = false;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    if (PERSIST) {
      if (!process.env.DATABASE_URL) throw new Error("BEACON_PERSIST=true requires DATABASE_URL");
      ingestionRunId = await startIngestionRun({
        source: SOURCE,
        scope: SCOPE,
        agency: AGENCY_SLUG,
        metadata: { startUrl: START_URL, paginationMethod: "graphql-offset" },
      });
      console.log(`BEACON_INGESTION_RUN id=${ingestionRunId}`);
    } else {
      console.log("BEACON_PERSISTENCE disabled");
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 govTract/0.1 public-procurement-indexer",
    );

    page.on("response", (response) => {
      const capture = captureResponse(response, network, responseDirectory);
      pendingCaptures.add(capture);
      void capture.finally(() => pendingCaptures.delete(capture));
    });

    console.log(`BEACON_START ${START_URL}`);
    const documentResponse = await page.goto(START_URL, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });
    console.log(
      `BEACON_DOCUMENT status=${documentResponse?.status() ?? "unknown"} url=${redactUrl(page.url())}`,
    );
    await waitForSettled(page);

    await page.screenshot({ path: join(ARTIFACT_DIR, "listing.png"), fullPage: true });
    await writeFile(join(ARTIFACT_DIR, "listing.html"), await page.content(), "utf8");

    const canonicalUrls = await extractCanonicalUrls(page);
    const listRequest = findListSolicitationsRequest(network);
    if (!listRequest) throw new Error("Beacon page did not expose a ListSolicitations GraphQL request");

    const requestedPageSize = Number(listRequest.payload.variables.pageSize);
    if (Number.isInteger(requestedPageSize) && requestedPageSize > 0) {
      discoveredPageSize = requestedPageSize;
      pageSize = requestedPageSize;
    }
    if (Number.isInteger(PAGE_SIZE_OVERRIDE) && PAGE_SIZE_OVERRIDE > 0) pageSize = PAGE_SIZE_OVERRIDE;

    const initialStart = Number(listRequest.payload.variables.start);
    console.log(
      `BEACON_PAGINATION_DISCOVERED method=graphql-offset start=${Number.isFinite(initialStart) ? initialStart : 0} discoveredPageSize=${discoveredPageSize} effectivePageSize=${pageSize}`,
    );

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      pagesVisited = pageNumber;
      const start = (pageNumber - 1) * pageSize;
      lastCheckpoint = { start, pageSize };
      const result = await fetchGraphQlPage(
        page,
        listRequest.endpoint,
        listRequest.payload,
        start,
        pageSize,
      );
      reportedTotal = result.total;

      console.log(
        `BEACON_GRAPHQL_PAGE page=${pageNumber} start=${start} pageSize=${pageSize} rows=${result.rows.length} total=${result.total}`,
      );

      await writeFile(
        join(rawPageDirectory, `page-${String(pageNumber).padStart(3, "0")}.json`),
        JSON.stringify(result.parsed, null, 2),
        "utf8",
      );

      if (ingestionRunId) {
        await persistRawIngestionPage({
          runId: ingestionRunId,
          pageNumber,
          cursor: { start, pageSize },
          reportedTotal: result.total,
          rawPayload: result.parsed as unknown as Record<string, unknown>,
          recordCount: result.rows.length,
        });
      }

      const pageIds = result.rows
        .map((row) => (typeof row.id === "string" ? row.id.trim().toLowerCase() : ""))
        .filter(Boolean);
      const signature = [...pageIds].sort().join("|");
      if (seenPageSignatures.has(signature)) {
        terminalReason = "repeated-graphql-page-signature";
        status = "partial";
        break;
      }
      seenPageSignatures.add(signature);

      const pageCounts: PagePersistenceCounts = { inserted: 0, updated: 0, unchanged: 0 };

      for (const row of result.rows) {
        const rawSourceId = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
        if (rawSourceId) seenSourceIds.add(rawSourceId);
        const canonicalUrl = rawSourceId
          ? canonicalUrls.get(rawSourceId) ??
            `https://www.beaconbid.com/solicitations/${AGENCY_SLUG}/${rawSourceId}`
          : START_URL;

        let sourceRecordPk: string | null = null;
        try {
          const sourceRecord = toBeaconSourceRecord({ row, canonicalUrl });
          if (ingestionRunId) {
            const persisted = await persistSourceRecord({
              runId: ingestionRunId,
              source: SOURCE,
              agency: AGENCY_SLUG,
              record: sourceRecord,
            });
            sourceRecordPk = persisted.sourceRecordPk;
            incrementCount(pageCounts, persisted.change);
          }
        } catch (error) {
          recordErrorCount += 1;
          const message = errorText(error);
          console.error(`BEACON_RECORD_ERROR page=${pageNumber} stage=source-persistence sourceId=${rawSourceId || "unknown"} ${message}`);
          if (ingestionRunId) {
            await recordIngestionRecordError({
              runId: ingestionRunId,
              pageNumber,
              sourceRecordId: rawSourceId || null,
              stage: "source-persistence",
              error: message,
              rawPayload: row,
            });
          }
          continue;
        }

        let normalized;
        try {
          normalized = normalizeBeaconSolicitation({
            row,
            canonicalUrl,
            agencySlug: AGENCY_SLUG,
            canonicalStatus: SCOPE,
          });
        } catch (error) {
          recordErrorCount += 1;
          const message = errorText(error);
          console.error(`BEACON_RECORD_ERROR page=${pageNumber} stage=normalization sourceId=${rawSourceId || "unknown"} ${message}`);
          if (ingestionRunId) {
            await recordIngestionRecordError({
              runId: ingestionRunId,
              pageNumber,
              sourceRecordId: rawSourceId || null,
              stage: "normalization",
              error: message,
              rawPayload: row,
            });
          }
          continue;
        }

        try {
          if (ingestionRunId && sourceRecordPk) {
            await persistNormalizedOpportunity({
              source: SOURCE,
              sourceRecordPk,
              record: normalized,
            });
          }
        } catch (error) {
          recordErrorCount += 1;
          const message = errorText(error);
          console.error(`BEACON_RECORD_ERROR page=${pageNumber} stage=canonical-persistence sourceId=${normalized.sourceRecordId} ${message}`);
          if (ingestionRunId) {
            await recordIngestionRecordError({
              runId: ingestionRunId,
              pageNumber,
              sourceRecordId: normalized.sourceRecordId,
              stage: "canonical-persistence",
              error: message,
              rawPayload: row,
            });
          }
          continue;
        }

        if (!solicitations.has(normalized.sourceRecordId)) {
          solicitations.set(normalized.sourceRecordId, {
            sourceId: normalized.sourceRecordId,
            ...(row.revisionId ? { revisionId: row.revisionId } : {}),
            ...(row.refnum ? { refnum: row.refnum } : {}),
            title: normalized.title,
            ...(normalized.status ? { status: normalized.status } : {}),
            ...(normalized.sourceStatus ? { sourceStatus: normalized.sourceStatus } : {}),
            ...(row.type ? { type: row.type } : {}),
            ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
            ...(row.modifiedAt ? { modifiedAt: row.modifiedAt } : {}),
            ...(row.issueDate ? { issueDate: row.issueDate } : {}),
            ...(row.dueDate ? { dueDate: row.dueDate } : {}),
            ...(normalized.departments.length > 0 ? { departments: normalized.departments } : {}),
            url: normalized.canonicalUrl ??
              `https://www.beaconbid.com/solicitations/${AGENCY_SLUG}/${normalized.sourceRecordId}`,
            page: pageNumber,
          });
        }
      }

      if (ingestionRunId) {
        await recordPagePersistenceCounts({ runId: ingestionRunId, counts: pageCounts });
      }
      persistenceCounts.inserted += pageCounts.inserted;
      persistenceCounts.updated += pageCounts.updated;
      persistenceCounts.unchanged += pageCounts.unchanged;
      console.log(
        `BEACON_DB_PAGE page=${pageNumber} inserted=${pageCounts.inserted} updated=${pageCounts.updated} unchanged=${pageCounts.unchanged} recordErrors=${recordErrorCount}`,
      );

      if (seenSourceIds.size >= result.total) {
        paginationComplete = true;
        terminalReason = recordErrorCount > 0
          ? "record-errors-after-complete-pagination"
          : "graphql-total-reached";
        status = recordErrorCount > 0 ? "partial" : "complete";
        break;
      }

      if (result.rows.length === 0) {
        terminalReason = "empty-page-before-total";
        status = "partial";
        break;
      }

      if (pageNumber === MAX_PAGES) {
        terminalReason = "maximum-page-bound-reached";
        status = "partial";
      }
    }

    if (reportedTotal === 0) {
      terminalReason = "graphql-total-zero";
      status = "partial";
      paginationComplete = false;
    }
  } catch (error) {
    runError = errorText(error);
    terminalReason = "exception";
    status = "failed";
    console.error(runError);
  } finally {
    await Promise.allSettled([...pendingCaptures]);
    await browser.close();
  }

  const normalizationComplete = paginationComplete && recordErrorCount === 0;

  if (ingestionRunId) {
    try {
      if (status === "complete" && normalizationComplete && reportedTotal !== null && reportedTotal > 0) {
        await reconcileCompleteScope({
          source: SOURCE,
          agency: AGENCY_SLUG,
          seenSourceRecordIds: [...seenSourceIds],
        });
      }
      await finishIngestionRun({
        runId: ingestionRunId,
        status,
        reportedTotal,
        pagesFetched: pagesVisited,
        recordsSeen: seenSourceIds.size,
        checkpoint: lastCheckpoint,
        paginationComplete,
        normalizationComplete,
        error: runError,
      });
    } catch (error) {
      const persistenceError = errorText(error);
      runError = runError ? `${runError}\nPersistence finalization: ${persistenceError}` : persistenceError;
      terminalReason = "persistence-finalization-failed";
      status = "failed";
      console.error(persistenceError);
    } finally {
      await closeDb();
    }
  }

  const solicitationList = [...solicitations.values()].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId),
  );
  const networkCandidates = [...new Set(network.map((entry) => entry.url))];

  await writeFile(
    join(ARTIFACT_DIR, "solicitations.json"),
    JSON.stringify(solicitationList, null, 2),
    "utf8",
  );
  await writeFile(
    join(networkDirectory, "requests.json"),
    JSON.stringify(network, null, 2),
    "utf8",
  );

  const summary: RunSummary = {
    source: "beacon",
    agency: AGENCY_SLUG,
    startUrl: START_URL,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    pagesVisited,
    discoveredPageSize,
    pageSize,
    reportedTotal,
    sourceRecordCount: seenSourceIds.size,
    solicitationCount: solicitationList.length,
    recordErrorCount,
    paginationComplete,
    normalizationComplete,
    networkCandidateCount: networkCandidates.length,
    paginationMethod: "graphql-offset",
    terminalReason,
    persisted: Boolean(ingestionRunId),
    ...(ingestionRunId ? { ingestionRunId } : {}),
    insertedCount: persistenceCounts.inserted,
    updatedCount: persistenceCounts.updated,
    unchangedCount: persistenceCounts.unchanged,
    ...(runError ? { error: runError } : {}),
  };

  await writeFile(
    join(ARTIFACT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(`BEACON_SUMMARY ${JSON.stringify(summary)}`);
  for (const record of solicitationList) {
    console.log(
      `SOLICITATION sourceId=${record.sourceId} page=${record.page} status=${JSON.stringify(record.status ?? null)} sourceStatus=${JSON.stringify(record.sourceStatus ?? null)} refnum=${JSON.stringify(record.refnum ?? null)} title=${JSON.stringify(record.title)} url=${record.url}`,
    );
  }

  if (status !== "complete") process.exitCode = 1;
}

void main();
