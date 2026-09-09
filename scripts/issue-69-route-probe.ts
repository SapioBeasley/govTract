import puppeteer from "puppeteer";

import { closeDb } from "../lib/db/client";
import { getBeaconSessionCookies } from "../lib/procurement/sources/beacon/session-transport";
import { loadSourceConnectionSession } from "../lib/source-connections/repository";

const pages = [
  {
    label: "registered",
    url: "https://www.beaconbid.com/solicitations/city-of-houston/892d339e-2dcb-4700-8d61-42785a5e0554/industrial-fire-brigade-structural-fire-trainer",
  },
  {
    label: "unregistered-candidate",
    url: "https://www.beaconbid.com/solicitations/city-of-houston/4bc0ff91-dee7-4859-823e-345b29dde1e5/diaphram-pumps",
  },
];

const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

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

    for (const item of pages) {
      const page = await browser.newPage();
      await page.setUserAgent(userAgent);
      await page.goto(item.url, { waitUntil: "networkidle2", timeout: 60_000 });
      await new Promise((resolve) => setTimeout(resolve, 750));

      const state = await page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        const normalized = text.replace(/\s+/g, " ");
        const hrefs = Array.from(document.querySelectorAll("a[href]"))
          .map((element) => element.getAttribute("href") ?? "")
          .filter(Boolean);

        return {
          hasRequestDocuments: /request documents/i.test(normalized),
          hasDownloadPackage: /download package/i.test(normalized),
          hasPlanholderDocumentLink: hrefs.some((href) => href.includes("/api/planholder/document/")),
          planholderDocumentLinkCount: hrefs.filter((href) => href.includes("/api/planholder/document/")).length,
        };
      });

      console.log("BEACON_PAGE_ACCESS_STATE", JSON.stringify({ label: item.label, ...state }));
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .catch(() => {
    console.error("Beacon page access-state probe failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
