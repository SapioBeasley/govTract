import type { HistoricalProcurementSourceContext } from "@/lib/procurement/historical/adapter";

import {
  HOUSTON_CHECKBOOK_AGENCY,
  HOUSTON_CHECKBOOK_DATASET_URL,
  HOUSTON_CHECKBOOK_SOURCE,
  houstonCheckbookAdapter,
  type HoustonCheckbookRecord,
} from "./adapter";
import type {
  HoustonCheckbookClient,
  HoustonCheckbookPage,
  HoustonCheckbookResource,
} from "./client";

export type HoustonCheckbookIngestionMode = "backfill" | "refresh";

export interface HoustonCheckbookCheckpoint {
  mode: HoustonCheckbookIngestionMode;
  fiscalYear: number;
  resourceId: string;
  offset: number;
  pageSize: number;
  resourceComplete: boolean;
}

export interface HoustonCheckbookCoverage {
  fiscalYear: number;
  resourceId: string;
  revision: string;
  fetched: number;
  reportedTotal: number;
  complete: boolean;
}

export interface HoustonCheckbookIngestionSummary {
  runId: string;
  mode: HoustonCheckbookIngestionMode;
  status: "complete" | "partial" | "failed";
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  pagesFetched: number;
  paginationComplete: boolean;
  normalizationComplete: boolean;
  checkpoint: HoustonCheckbookCheckpoint | null;
  coverage: HoustonCheckbookCoverage[];
  error?: string;
}

export interface HoustonCheckbookIngestionDependencies {
  startRun(input: {
    source: string;
    scope: string;
    agency: string;
    metadata: Record<string, unknown>;
  }): Promise<string>;
  persistPage(input: {
    runId: string;
    pageNumber: number;
    cursor: Record<string, unknown>;
    reportedTotal: number;
    rawPayload: Record<string, unknown>;
    recordCount: number;
  }): Promise<void>;
  persistBatch(input: {
    adapter: typeof houstonCheckbookAdapter;
    runId: string;
    records: readonly HoustonCheckbookRecord[];
    context: HistoricalProcurementSourceContext;
  }): Promise<{
    processed: number;
    inserted: number;
    updated: number;
    unchanged: number;
    errors: number;
  }>;
  finishRun(input: {
    runId: string;
    status: "complete" | "partial" | "failed";
    reportedTotal: number | null;
    pagesFetched: number;
    recordsSeen: number;
    checkpoint: Record<string, unknown>;
    paginationComplete: boolean;
    normalizationComplete: boolean;
    error?: string;
  }): Promise<void>;
}

interface HoustonCheckbookClientLike {
  discoverResources(): Promise<HoustonCheckbookResource[]>;
  fetchPage(
    resource: HoustonCheckbookResource,
    input: { limit: number; offset: number },
  ): Promise<HoustonCheckbookPage>;
}

function sourceContext(resource: HoustonCheckbookResource): HistoricalProcurementSourceContext {
  const publishedAt = resource.resourceModifiedAt ? new Date(resource.resourceModifiedAt) : null;
  return {
    agency: HOUSTON_CHECKBOOK_AGENCY,
    canonicalUrl: HOUSTON_CHECKBOOK_DATASET_URL,
    sourceFile: {
      id: resource.resourceId,
      revision: resource.resourceRevision,
      publishedAt:
        publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      metadata: {
        packageName: resource.packageName,
        resourceName: resource.resourceName,
        fiscalYear: resource.fiscalYear,
        resourceUrl: resource.resourceUrl,
      },
    },
  };
}

function selectResources(
  resources: readonly HoustonCheckbookResource[],
  mode: HoustonCheckbookIngestionMode,
  fiscalYears?: readonly number[],
) {
  if (resources.length === 0) {
    throw new Error("Houston Checkbook discovery returned no ingestible resources");
  }

  const requestedYears = fiscalYears ? new Set(fiscalYears) : null;
  const eligible = requestedYears
    ? resources.filter((resource) => requestedYears.has(resource.fiscalYear))
    : [...resources];

  if (requestedYears && eligible.length === 0) {
    throw new Error(
      `Houston Checkbook discovery returned no requested fiscal years: ${[...requestedYears].join(",")}`,
    );
  }

  if (mode === "backfill" || requestedYears) {
    return eligible.sort((a, b) => a.fiscalYear - b.fiscalYear);
  }

  const newestYear = Math.max(...eligible.map((resource) => resource.fiscalYear));
  return eligible
    .filter((resource) => resource.fiscalYear === newestYear)
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
}

function makeCheckpoint(input: {
  mode: HoustonCheckbookIngestionMode;
  resource: HoustonCheckbookResource;
  offset: number;
  pageSize: number;
  resourceComplete: boolean;
}): HoustonCheckbookCheckpoint {
  return {
    mode: input.mode,
    fiscalYear: input.resource.fiscalYear,
    resourceId: input.resource.resourceId,
    offset: input.offset,
    pageSize: input.pageSize,
    resourceComplete: input.resourceComplete,
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runHoustonCheckbookIngestion(input: {
  client: HoustonCheckbookClient | HoustonCheckbookClientLike;
  dependencies: HoustonCheckbookIngestionDependencies;
  mode: HoustonCheckbookIngestionMode;
  pageSize?: number;
  maxPages?: number;
  fiscalYears?: readonly number[];
  resume?: {
    resourceId: string;
    offset: number;
  };
}): Promise<HoustonCheckbookIngestionSummary> {
  const pageSize = input.pageSize ?? 1_000;
  const maxPages = input.maxPages ?? 10_000;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10_000) {
    throw new Error(`Invalid Houston Checkbook ingestion page size: ${pageSize}`);
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Invalid Houston Checkbook maximum page count: ${maxPages}`);
  }
  if (
    input.resume &&
    (!Number.isInteger(input.resume.offset) || input.resume.offset < 0)
  ) {
    throw new Error(`Invalid Houston Checkbook resume offset: ${input.resume.offset}`);
  }

  if (
    input.fiscalYears &&
    input.fiscalYears.some((year) => !Number.isInteger(year) || year < 2000 || year > 2200)
  ) {
    throw new Error("Houston Checkbook fiscal-year filters must be four-digit years");
  }

  const discovered = await input.client.discoverResources();
  let resources = selectResources(discovered, input.mode, input.fiscalYears);

  if (input.resume) {
    const resumeIndex = resources.findIndex(
      (resource) => resource.resourceId === input.resume?.resourceId,
    );
    if (resumeIndex < 0) {
      throw new Error(
        `Houston Checkbook resume resource was not discovered: ${input.resume.resourceId}`,
      );
    }
    resources = resources.slice(resumeIndex);
  }

  const runId = await input.dependencies.startRun({
    source: HOUSTON_CHECKBOOK_SOURCE,
    scope: input.mode,
    agency: HOUSTON_CHECKBOOK_AGENCY,
    metadata: {
      datasetUrl: HOUSTON_CHECKBOOK_DATASET_URL,
      mode: input.mode,
      pageSize,
      maxPages,
      resourceIds: resources.map((resource) => resource.resourceId),
      fiscalYears: resources.map((resource) => resource.fiscalYear),
      ...(input.resume ? { resume: input.resume } : {}),
    },
  });

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;
  let pagesFetched = 0;
  let checkpoint: HoustonCheckbookCheckpoint | null = null;
  let paginationComplete = true;
  let status: HoustonCheckbookIngestionSummary["status"] = "complete";
  let runError: string | undefined;
  const coverage: HoustonCheckbookCoverage[] = [];
  let reportedTotal = 0;

  try {
    outer: for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex += 1) {
      const resource = resources[resourceIndex];
      if (!resource) continue;

      let offset =
        input.resume && resource.resourceId === input.resume.resourceId
          ? input.resume.offset
          : 0;
      let resourceFetched = 0;
      let resourceTotal = 0;
      let resourceComplete = false;

      while (!resourceComplete) {
        if (pagesFetched >= maxPages) {
          paginationComplete = false;
          status = "partial";
          checkpoint = makeCheckpoint({
            mode: input.mode,
            resource,
            offset,
            pageSize,
            resourceComplete: false,
          });
          coverage.push({
            fiscalYear: resource.fiscalYear,
            resourceId: resource.resourceId,
            revision: resource.resourceRevision,
            fetched: resourceFetched,
            reportedTotal: resourceTotal,
            complete: false,
          });
          break outer;
        }

        const page = await input.client.fetchPage(resource, {
          limit: pageSize,
          offset,
        });
        pagesFetched += 1;
        resourceTotal = page.total;
        reportedTotal += pagesFetched === 1 || offset === 0 ? page.total : 0;

        const records = page.records.map(
          (row): HoustonCheckbookRecord => ({
            source: resource,
            row,
          }),
        );
        const nextOffset = offset + records.length;
        resourceComplete = nextOffset >= page.total;
        checkpoint = makeCheckpoint({
          mode: input.mode,
          resource,
          offset: nextOffset,
          pageSize,
          resourceComplete,
        });

        await input.dependencies.persistPage({
          runId,
          pageNumber: pagesFetched,
          cursor: checkpoint,
          reportedTotal: page.total,
          rawPayload: {
            source: {
              packageName: resource.packageName,
              resourceId: resource.resourceId,
              resourceName: resource.resourceName,
              resourceRevision: resource.resourceRevision,
              resourceModifiedAt: resource.resourceModifiedAt ?? null,
              resourceUrl: resource.resourceUrl,
              fiscalYear: resource.fiscalYear,
            },
            fields: page.fields,
            records: page.records,
            total: page.total,
            limit: page.limit,
            offset: page.offset,
          },
          recordCount: records.length,
        });

        const counts = await input.dependencies.persistBatch({
          adapter: houstonCheckbookAdapter,
          runId,
          records,
          context: sourceContext(resource),
        });

        fetched += records.length;
        resourceFetched += records.length;
        inserted += counts.inserted;
        updated += counts.updated;
        unchanged += counts.unchanged;
        rejected += counts.errors;

        if (records.length === 0 && !resourceComplete) {
          paginationComplete = false;
          status = "partial";
          checkpoint = makeCheckpoint({
            mode: input.mode,
            resource,
            offset,
            pageSize,
            resourceComplete: false,
          });
          coverage.push({
            fiscalYear: resource.fiscalYear,
            resourceId: resource.resourceId,
            revision: resource.resourceRevision,
            fetched: resourceFetched,
            reportedTotal: resourceTotal,
            complete: false,
          });
          break outer;
        }

        offset = nextOffset;
      }

      coverage.push({
        fiscalYear: resource.fiscalYear,
        resourceId: resource.resourceId,
        revision: resource.resourceRevision,
        fetched: resourceFetched,
        reportedTotal: resourceTotal,
        complete: resourceComplete,
      });
    }

    if (rejected > 0 && status === "complete") status = "partial";
  } catch (error) {
    status = "failed";
    paginationComplete = false;
    runError = errorText(error);
  }

  const normalizationComplete = paginationComplete && rejected === 0 && status === "complete";

  await input.dependencies.finishRun({
    runId,
    status,
    reportedTotal: reportedTotal || null,
    pagesFetched,
    recordsSeen: fetched,
    checkpoint: checkpoint ?? {
      mode: input.mode,
      pageSize,
      complete: false,
    },
    paginationComplete,
    normalizationComplete,
    ...(runError ? { error: runError } : {}),
  });

  const summary: HoustonCheckbookIngestionSummary = {
    runId,
    mode: input.mode,
    status,
    fetched,
    inserted,
    updated,
    unchanged,
    rejected,
    pagesFetched,
    paginationComplete,
    normalizationComplete,
    checkpoint,
    coverage,
    ...(runError ? { error: runError } : {}),
  };

  if (status === "failed") {
    throw new Error(
      `Houston Checkbook ingestion failed: ${runError ?? "unknown error"}`,
    );
  }

  return summary;
}
