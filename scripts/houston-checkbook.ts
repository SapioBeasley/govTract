import {
  closeDb,
  finishIngestionRun,
  persistRawIngestionPage,
  startIngestionRun,
} from "@/lib/procurement/ingestion/persistence";
import { persistHistoricalProcurementBatch } from "@/lib/procurement/historical/persistence";
import { HoustonCheckbookClient } from "@/lib/procurement/sources/houston-checkbook/client";
import {
  runHoustonCheckbookIngestion,
  type HoustonCheckbookIngestionMode,
} from "@/lib/procurement/sources/houston-checkbook/ingest";

function argument(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match?.slice(prefix.length) ?? null;
}

function positiveInteger(name: string, fallback: number) {
  const raw = argument(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(name: string) {
  const raw = argument(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

function mode(): HoustonCheckbookIngestionMode {
  const value = argument("mode") ?? "refresh";
  if (value !== "backfill" && value !== "refresh") {
    throw new Error("--mode must be backfill or refresh");
  }
  return value;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Houston Checkbook ingestion");
  }

  const selectedMode = mode();
  const pageSize = positiveInteger("page-size", 1_000);
  const maxPages = positiveInteger("max-pages", 5_000);
  const resumeResourceId = argument("resume-resource");
  const resumeOffset = nonnegativeInteger("resume-offset");

  if ((resumeResourceId === null) !== (resumeOffset === null)) {
    throw new Error("--resume-resource and --resume-offset must be supplied together");
  }

  const summary = await runHoustonCheckbookIngestion({
    client: new HoustonCheckbookClient(),
    dependencies: {
      startRun: startIngestionRun,
      persistPage: persistRawIngestionPage,
      persistBatch: persistHistoricalProcurementBatch,
      finishRun: finishIngestionRun,
    },
    mode: selectedMode,
    pageSize,
    maxPages,
    ...(resumeResourceId !== null && resumeOffset !== null
      ? {
          resume: {
            resourceId: resumeResourceId,
            offset: resumeOffset,
          },
        }
      : {}),
  });

  console.log(`HOUSTON_CHECKBOOK_SUMMARY ${JSON.stringify(summary)}`);

  for (const file of summary.coverage) {
    console.log(
      [
        "HOUSTON_CHECKBOOK_FILE",
        `fiscalYear=${file.fiscalYear}`,
        `resourceId=${file.resourceId}`,
        `revision=${file.revision}`,
        `fetched=${file.fetched}`,
        `reportedTotal=${file.reportedTotal}`,
        `complete=${file.complete}`,
      ].join(" "),
    );
  }

  if (summary.status !== "complete") process.exitCode = 1;
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
