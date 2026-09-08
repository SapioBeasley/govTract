import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer, { type HTTPResponse, type Page } from "puppeteer";

const START_URL =
  process.env.BEACON_START_URL ??
  "https://www.beaconbid.com/solicitations/city-of-houston/open";
const MAX_PAGES = Number(process.env.BEACON_MAX_PAGES ?? "100");
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const RESPONSE_BODY_LIMIT = Number(
  process.env.BEACON_RESPONSE_BODY_LIMIT ?? String(2 * 1024 * 1024),
);

const solicitationPathPattern =
  /^\/solicitations\/city-of-houston\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

interface SolicitationRecord {
  sourceId: string;
  title: string;
  url: string;
  page: number;
  evidenceText: string;
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
  agency: "city-of-houston";
  startUrl: string;
  startedAt: string;
  completedAt: string;
  status: "complete" | "partial" | "failed";
  pagesVisited: number;
  solicitationCount: number;
  networkCandidateCount: number;
  terminalReason: string;
  error?: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const sensitive = /token|auth|signature|session|secret|password|email|key/i;

    for (const key of url.searchParams.keys()) {
      if (sensitive.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
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

async function autoScroll(page: Page) {
  let stableRounds = 0;

  for (let attempt = 0; attempt < 20 && stableRounds < 2; attempt += 1) {
    const before = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      links: document.querySelectorAll(
        'a[href*="/solicitations/city-of-houston/"]',
      ).length,
    }));

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await delay(750);

    const after = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      links: document.querySelectorAll(
        'a[href*="/solicitations/city-of-houston/"]',
      ).length,
    }));

    if (before.height === after.height && before.links === after.links) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
  }
}

async function extractSolicitations(page: Page, pageNumber: number) {
  const anchors = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => {
        const href = anchor.href;
        const ownText = anchor.textContent ?? "";
        const container = anchor.closest(
          "article, li, tr, [class*='card'], [class*='solicitation'], [class*='bid']",
        );

        return {
          href,
          text: ownText,
          evidenceText: container?.textContent ?? ownText,
        };
      })
      .filter((entry) => entry.href.includes("/solicitations/city-of-houston/")),
  );

  const records = new Map<string, SolicitationRecord>();

  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href);
      const match = url.pathname.match(solicitationPathPattern);
      if (!match) continue;

      const sourceId = match[1].toLowerCase();
      const title = normalizeWhitespace(anchor.text) || sourceId;
      const evidenceText = normalizeWhitespace(anchor.evidenceText).slice(0, 2_000);

      records.set(sourceId, {
        sourceId,
        title,
        url: `${url.origin}${url.pathname}`,
        page: pageNumber,
        evidenceText,
      });
    } catch {
      // Ignore malformed hrefs and continue collecting the rest of the page.
    }
  }

  return [...records.values()];
}

async function pageSignature(page: Page, records: SolicitationRecord[]) {
  if (records.length > 0) {
    return records
      .map((record) => record.sourceId)
      .sort()
      .join("|");
  }

  return page.evaluate(() =>
    (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 10_000),
  );
}

async function clickNextPaginationControl(page: Page) {
  const navigation = page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 10_000 })
    .catch(() => null);

  const result = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a, button, [role="button"]'),
    );

    const scored = candidates
      .map((element) => {
        const label = [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const rel = element.getAttribute("rel") ?? "";
        const disabled =
          element.getAttribute("aria-disabled") === "true" ||
          (element instanceof HTMLButtonElement && element.disabled);
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0;

        let score = 0;
        if (/^next(?:\s+page)?$/i.test(label)) score += 100;
        if (/\bnext\b/i.test(label)) score += 80;
        if ([">", "›", "»"].includes(label)) score += 60;
        if (/\bnext\b/i.test(rel)) score += 120;

        return { element, label, score, disabled, visible };
      })
      .filter(
        (candidate) =>
          candidate.score > 0 && !candidate.disabled && candidate.visible,
      )
      .sort((a, b) => b.score - a.score);

    const next = scored[0];
    if (!next) {
      return { clicked: false, label: null as string | null };
    }

    next.element.scrollIntoView({ block: "center" });
    next.element.click();
    return { clicked: true, label: next.label };
  });

  if (!result.clicked) return result;

  await Promise.race([navigation, delay(5_000)]);
  await waitForSettled(page);
  return result;
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

async function main() {
  const startedAt = new Date().toISOString();
  const networkDirectory = join(ARTIFACT_DIR, "network");
  const responseDirectory = join(networkDirectory, "responses");
  await mkdir(responseDirectory, { recursive: true });

  const network: NetworkEntry[] = [];
  const pendingCaptures = new Set<Promise<void>>();
  const solicitations = new Map<string, SolicitationRecord>();
  const seenPageSignatures = new Set<string>();
  let pagesVisited = 0;
  let terminalReason = "unknown";
  let status: RunSummary["status"] = "failed";
  let runError: string | undefined;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
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
    const response = await page.goto(START_URL, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });

    console.log(
      `BEACON_DOCUMENT status=${response?.status() ?? "unknown"} url=${redactUrl(page.url())}`,
    );
    await waitForSettled(page);

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      pagesVisited = pageNumber;
      await autoScroll(page);
      await waitForSettled(page);

      const pageRecords = await extractSolicitations(page, pageNumber);
      const signature = await pageSignature(page, pageRecords);

      console.log(
        `BEACON_PAGE page=${pageNumber} records=${pageRecords.length} url=${redactUrl(page.url())}`,
      );

      if (seenPageSignatures.has(signature)) {
        terminalReason = "repeated-page-signature";
        status = "partial";
        break;
      }
      seenPageSignatures.add(signature);

      for (const record of pageRecords) {
        if (!solicitations.has(record.sourceId)) {
          solicitations.set(record.sourceId, record);
        }
      }

      await page.screenshot({
        path: join(ARTIFACT_DIR, `page-${String(pageNumber).padStart(3, "0")}.png`),
        fullPage: true,
      });

      const html = await page.content();
      await writeFile(
        join(ARTIFACT_DIR, `page-${String(pageNumber).padStart(3, "0")}.html`),
        html,
        "utf8",
      );

      const next = await clickNextPaginationControl(page);
      console.log(
        `BEACON_PAGINATION page=${pageNumber} clicked=${next.clicked} label=${JSON.stringify(next.label)}`,
      );

      if (!next.clicked) {
        terminalReason = "no-enabled-next-control";
        status = solicitations.size > 0 ? "complete" : "partial";
        break;
      }

      if (pageNumber === MAX_PAGES) {
        terminalReason = "maximum-page-bound-reached";
        status = "partial";
      }
    }

    if (solicitations.size === 0 && status !== "failed") {
      terminalReason = `${terminalReason};zero-solicitation-links`;
      status = "partial";
    }
  } catch (error) {
    runError = error instanceof Error ? error.stack ?? error.message : String(error);
    terminalReason = "exception";
    status = "failed";
    console.error(runError);
  } finally {
    await Promise.allSettled([...pendingCaptures]);
    await browser.close();
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
    agency: "city-of-houston",
    startUrl: START_URL,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    pagesVisited,
    solicitationCount: solicitationList.length,
    networkCandidateCount: networkCandidates.length,
    terminalReason,
    ...(runError ? { error: runError } : {}),
  };

  await writeFile(
    join(ARTIFACT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(`BEACON_SUMMARY ${JSON.stringify(summary)}`);
  for (const entry of network) {
    console.log(
      `NETWORK_CANDIDATE method=${entry.method} status=${entry.status} url=${entry.url}`,
    );
  }
  for (const record of solicitationList) {
    console.log(
      `SOLICITATION sourceId=${record.sourceId} page=${record.page} url=${record.url} title=${JSON.stringify(record.title)}`,
    );
  }

  if (status !== "complete") {
    process.exitCode = 1;
  }
}

void main();
