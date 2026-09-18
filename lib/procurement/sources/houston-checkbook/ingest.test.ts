import assert from "node:assert/strict";
import test from "node:test";

import type { HoustonCheckbookResource } from "./client";
import {
  runHoustonCheckbookIngestion,
  type HoustonCheckbookIngestionDependencies,
} from "./ingest";

function resource(fiscalYear: number): HoustonCheckbookResource {
  return {
    fiscalYear,
    packageName: "checkbook",
    resourceId: `resource-${fiscalYear}`,
    resourceName: `Checkbook ${fiscalYear}`,
    resourceRevision: `hash-${fiscalYear}`,
    resourceModifiedAt: `${fiscalYear}-07-01T00:00:00Z`,
    resourceUrl: `https://data.houstontx.gov/checkbook-${fiscalYear}.csv`,
  };
}

function createFixture(input?: {
  failRowId?: number;
  resources?: HoustonCheckbookResource[];
}) {
  const resources = input?.resources ?? [resource(2025), resource(2026)];
  const pages = new Map<string, Record<number, Array<Record<string, unknown>>>>([
    [
      "resource-2025",
      new Map([
        [0, [{ _id: 1 }, { _id: 2 }]],
        [2, [{ _id: 3 }]],
      ]) as unknown as Record<number, Array<Record<string, unknown>>>,
    ],
    [
      "resource-2026",
      new Map([[0, [{ _id: 4 }, { _id: 5 }]]]) as unknown as Record<
        number,
        Array<Record<string, unknown>>
      >,
    ],
  ]);

  const clientCalls: Array<{ resourceId: string; limit: number; offset: number }> = [];
  const persistedPages: Array<{
    pageNumber: number;
    cursor: Record<string, unknown>;
    recordCount: number;
  }> = [];
  const persistedBatchRows: number[] = [];
  const finishes: Array<Record<string, unknown>> = [];

  const client = {
    async discoverResources() {
      return resources;
    },
    async fetchPage(selected: HoustonCheckbookResource, inputPage: { limit: number; offset: number }) {
      clientCalls.push({
        resourceId: selected.resourceId,
        limit: inputPage.limit,
        offset: inputPage.offset,
      });
      const rows =
        (pages.get(selected.resourceId) as unknown as Map<
          number,
          Array<Record<string, unknown>>
        > | undefined)?.get(inputPage.offset) ?? [];
      const total = selected.fiscalYear === 2025 ? 3 : 2;
      return {
        fields: [{ id: "_id", type: "int" }],
        records: rows,
        total,
        limit: inputPage.limit,
        offset: inputPage.offset,
      };
    },
  };

  const dependencies: HoustonCheckbookIngestionDependencies = {
    async startRun() {
      return "run-fixture";
    },
    async persistPage(page) {
      persistedPages.push({
        pageNumber: page.pageNumber,
        cursor: page.cursor,
        recordCount: page.recordCount,
      });
    },
    async persistBatch(batch) {
      let errors = 0;
      let inserted = 0;
      for (const record of batch.records) {
        const rowId = Number(record.row._id);
        persistedBatchRows.push(rowId);
        if (rowId === input?.failRowId) errors += 1;
        else inserted += 1;
      }
      return {
        processed: batch.records.length,
        inserted,
        updated: 0,
        unchanged: 0,
        errors,
      };
    },
    async finishRun(finish) {
      finishes.push(finish as unknown as Record<string, unknown>);
    },
  };

  return {
    client,
    dependencies,
    clientCalls,
    persistedPages,
    persistedBatchRows,
    finishes,
  };
}

test("Houston Checkbook backfill traverses every fiscal-year resource, checkpoints each page, and isolates rejected rows", async () => {
  const fixture = createFixture({ failRowId: 2 });

  const summary = await runHoustonCheckbookIngestion({
    client: fixture.client,
    dependencies: fixture.dependencies,
    mode: "backfill",
    pageSize: 2,
  });

  assert.deepEqual(
    fixture.clientCalls.map(({ resourceId, offset }) => [resourceId, offset]),
    [
      ["resource-2025", 0],
      ["resource-2025", 2],
      ["resource-2026", 0],
    ],
  );
  assert.deepEqual(fixture.persistedBatchRows, [1, 2, 3, 4, 5]);
  assert.equal(summary.fetched, 5);
  assert.equal(summary.inserted, 4);
  assert.equal(summary.updated, 0);
  assert.equal(summary.unchanged, 0);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.status, "partial");
  assert.equal(summary.paginationComplete, true);
  assert.equal(summary.normalizationComplete, false);
  assert.deepEqual(summary.coverage, [
    {
      fiscalYear: 2025,
      resourceId: "resource-2025",
      revision: "hash-2025",
      fetched: 3,
      reportedTotal: 3,
      complete: true,
    },
    {
      fiscalYear: 2026,
      resourceId: "resource-2026",
      revision: "hash-2026",
      fetched: 2,
      reportedTotal: 2,
      complete: true,
    },
  ]);
  assert.deepEqual(fixture.persistedPages.at(-1)?.cursor, {
    mode: "backfill",
    fiscalYear: 2026,
    resourceId: "resource-2026",
    offset: 2,
    pageSize: 2,
    resourceComplete: true,
  });
  assert.equal(fixture.finishes.length, 1);
  assert.equal(fixture.finishes[0]?.status, "partial");
});

test("Houston Checkbook refresh selects only the newest resource and can restart from an explicit offset", async () => {
  const fixture = createFixture();

  const summary = await runHoustonCheckbookIngestion({
    client: fixture.client,
    dependencies: fixture.dependencies,
    mode: "refresh",
    pageSize: 2,
    resume: {
      resourceId: "resource-2026",
      offset: 0,
    },
  });

  assert.deepEqual(
    fixture.clientCalls.map(({ resourceId, offset }) => [resourceId, offset]),
    [["resource-2026", 0]],
  );
  assert.equal(summary.status, "complete");
  assert.equal(summary.fetched, 2);
  assert.equal(summary.rejected, 0);
  assert.deepEqual(summary.coverage.map((entry) => entry.fiscalYear), [2026]);
});

test("Houston Checkbook ingestion stops at the configured page bound with a restartable checkpoint", async () => {
  const fixture = createFixture({ resources: [resource(2025)] });

  const summary = await runHoustonCheckbookIngestion({
    client: fixture.client,
    dependencies: fixture.dependencies,
    mode: "backfill",
    pageSize: 2,
    maxPages: 1,
  });

  assert.equal(summary.status, "partial");
  assert.equal(summary.paginationComplete, false);
  assert.equal(summary.fetched, 2);
  assert.deepEqual(summary.checkpoint, {
    mode: "backfill",
    fiscalYear: 2025,
    resourceId: "resource-2025",
    offset: 2,
    pageSize: 2,
    resourceComplete: false,
  });
  assert.deepEqual(summary.coverage, [
    {
      fiscalYear: 2025,
      resourceId: "resource-2025",
      revision: "hash-2025",
      fetched: 2,
      reportedTotal: 3,
      complete: false,
    },
  ]);
});
