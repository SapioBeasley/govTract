import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { closeDb } from "../lib/db/client";
import {
  applyBeaconLifecycleObservation,
  listBeaconLifecycleRefreshCandidates,
} from "../lib/procurement/sources/beacon/lifecycle-persistence";
import { parseBeaconRenderedLifecycle } from "../lib/procurement/sources/beacon/lifecycle";

const AGENCY_SLUG = process.env.BEACON_AGENCY ?? "city-of-houston";
const ARTIFACT_DIR = process.env.BEACON_ARTIFACT_DIR ?? ".artifacts/beacon";
const LIMIT = Math.max(1, Math.min(250, Number(process.env.BEACON_LIFECYCLE_REFRESH_LIMIT ?? "50")));
const PAGE_TIMEOUT_MS = Math.max(5_000, Number(process.env.BEACON_LIFECYCLE_PAGE_TIMEOUT_MS ?? "45000"));
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 lifecycle-reconciler";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown lifecycle refresh error";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Beacon lifecycle reconciliation");
  if (!Number.isFinite(LIMIT)) throw new Error("BEACON_LIFECYCLE_REFRESH_LIMIT must be a number");

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const candidates = await listBeaconLifecycleRefreshCandidates({
    agencySlug: AGENCY_SLUG,
    limit: LIMIT,
  });
  const outcomes: Array<Record<string, unknown>> = [];

  if (candidates.length === 0) {
    await writeFile(
      join(ARTIFACT_DIR, "lifecycle-reconciliation.json"),
      JSON.stringify({ agency: AGENCY_SLUG, candidates: 0, outcomes: [] }, null, 2),
      "utf8",
    );
    await closeDb();
    console.log("BEACON_LIFECYCLE_SUMMARY candidates=0 observed=0 errors=0");
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  let observed = 0;
  let errors = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENT);

    for (const candidate of candidates) {
      try {
        const response = await page.goto(candidate.canonicalUrl, {
          waitUntil: "networkidle2",
          timeout: PAGE_TIMEOUT_MS,
        });
        if (!response || !response.ok()) {
          throw new Error(`Beacon solicitation page returned HTTP ${response?.status() ?? "unknown"}`);
        }

        const pageText = await page.evaluate(() => document.body?.innerText ?? "");
        const observation = parseBeaconRenderedLifecycle(pageText);
        if (!observation) {
          outcomes.push({
            opportunityId: candidate.opportunityId,
            sourceOpportunityId: candidate.sourceOpportunityId,
            previousLifecycle: candidate.lifecycleState,
            result: "no_terminal_label",
          });
          continue;
        }

        const lifecycle = await applyBeaconLifecycleObservation({
          opportunityId: candidate.opportunityId,
          ...observation,
          sourceUrl: candidate.canonicalUrl,
        });
        observed += 1;
        outcomes.push({
          opportunityId: candidate.opportunityId,
          sourceOpportunityId: candidate.sourceOpportunityId,
          previousLifecycle: candidate.lifecycleState,
          observedSourceStatus: observation.sourceStatus,
          lifecycleState: lifecycle.state,
          result: "observed",
        });
        console.log(
          `BEACON_LIFECYCLE_OBSERVED opportunity=${candidate.opportunityId} state=${lifecycle.state} sourceStatus=${JSON.stringify(observation.sourceStatus)}`,
        );
      } catch (error) {
        errors += 1;
        outcomes.push({
          opportunityId: candidate.opportunityId,
          sourceOpportunityId: candidate.sourceOpportunityId,
          previousLifecycle: candidate.lifecycleState,
          result: "error",
          error: errorMessage(error),
        });
        console.error(
          `BEACON_LIFECYCLE_ERROR opportunity=${candidate.opportunityId} message=${JSON.stringify(errorMessage(error))}`,
        );
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await closeDb();
  }

  await writeFile(
    join(ARTIFACT_DIR, "lifecycle-reconciliation.json"),
    JSON.stringify(
      {
        agency: AGENCY_SLUG,
        limit: LIMIT,
        candidates: candidates.length,
        observed,
        errors,
        outcomes,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `BEACON_LIFECYCLE_SUMMARY candidates=${candidates.length} observed=${observed} errors=${errors}`,
  );
}

void main().catch(async (error) => {
  console.error(`BEACON_LIFECYCLE_FATAL ${JSON.stringify(errorMessage(error))}`);
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
