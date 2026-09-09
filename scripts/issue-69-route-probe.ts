import puppeteer from "puppeteer";

import { closeDb } from "../lib/db/client";
import { resolveBeaconDocumentDownloadUrl } from "../lib/procurement/sources/beacon/documents";
import { getBeaconSessionCookies } from "../lib/procurement/sources/beacon/session-transport";
import { loadSourceConnectionSession } from "../lib/source-connections/repository";

const detailUrl =
  "https://www.beaconbid.com/solicitations/city-of-houston/4bc0ff91-dee7-4859-823e-345b29dde1e5/diaphram-pumps";
const sourceOpportunityId = "4bc0ff91-dee7-4859-823e-345b29dde1e5";
const sourceDocumentKey =
  "agency/281287c2-49c0-439e-81d7-315d13b0b4fb/solicitation/1788896991406_1d5d7e67-a41b-4643-9d52-4f98d97115e7/PR10359426DiaphramPumps.pdf";
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

async function main() {
  const session = await loadSourceConnectionSession("beacon");
  const cookies = getBeaconSessionCookies(session);
  const documentUrl = resolveBeaconDocumentDownloadUrl({ sourceOpportunityId, sourceDocumentKey });
  if (!documentUrl) throw new Error("Could not build Beacon document route");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.setCookie(
      ...cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        ...(cookie.expires ? { expires: cookie.expires } : {}),
        ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
        ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      })),
    );

    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 60_000 });

    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include", redirect: "manual" });
      const text = await response.text();
      let message = "";
      let error = "";
      let statusCode: string | number | null = null;

      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        message = typeof parsed.message === "string" ? parsed.message : "";
        error = typeof parsed.error === "string" ? parsed.error : "";
        if (typeof parsed.statusCode === "string" || typeof parsed.statusCode === "number") {
          statusCode = parsed.statusCode;
        }
      } catch {
        // Do not expose non-JSON bodies.
      }

      const combined = `${message} ${error}`.toLowerCase();
      return {
        status: response.status,
        statusCode,
        keywordFlags: {
          access: /access/.test(combined),
          permission: /permission/.test(combined),
          authorized: /authori[sz]/.test(combined),
          planholder: /planholder/.test(combined),
          register: /register|registration/.test(combined),
          interest: /interest/.test(combined),
          supplier: /supplier/.test(combined),
          solicitation: /solicitation/.test(combined),
          document: /document/.test(combined),
          request: /request/.test(combined),
        },
      };
    }, documentUrl);

    console.log("BEACON_DOCUMENT_400_CLASSIFICATION", JSON.stringify(result));
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .catch(() => {
    console.error("Beacon document 400 classification probe failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
