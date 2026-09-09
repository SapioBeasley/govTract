import puppeteer from "puppeteer";

import { closeDb } from "../lib/db/client";
import { getBeaconSessionCookies } from "../lib/procurement/sources/beacon/session-transport";
import { loadSourceConnectionSession } from "../lib/source-connections/repository";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

function shape(value: unknown, depth = 0): unknown {
  if (depth > 3) return typeof value;
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", length: value.length, item: value.length ? shape(value[0], depth + 1) : null };
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, shape(child, depth + 1)]),
    );
  }
  return typeof value;
}

async function main() {
  const session = await loadSourceConnectionSession("beacon");
  const cookies = getBeaconSessionCookies(session);
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
    await page.setUserAgent(USER_AGENT);
    await page.goto("https://www.beaconbid.com", { waitUntil: "networkidle2", timeout: 60_000 });
    const payload = await page.evaluate(async () => {
      const response = await fetch("/api/rest/session", { credentials: "include" });
      return { status: response.status, json: await response.json() };
    });
    console.log("BEACON_SESSION_SHAPE", JSON.stringify({ status: payload.status, shape: shape(payload.json) }));
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .catch(() => {
    console.error("Beacon session shape probe failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
