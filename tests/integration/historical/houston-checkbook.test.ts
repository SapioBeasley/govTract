import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import type { HistoricalProcurementSourceAdapter } from "@/lib/procurement/historical/adapter";
import {
  persistHistoricalProcurementBatch,
  persistHistoricalProcurementSourceRecord,
} from "@/lib/procurement/historical/persistence";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import {
  houstonCheckbookAdapter,
  type HoustonCheckbookRecord,
} from "@/lib/procurement/sources/houston-checkbook/adapter";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function identity() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `houston-checkbook-fixture-${suffix}`,
    resourceId: `houston-resource-${suffix}`,
  };
}

function adapter(source: string): HistoricalProcurementSourceAdapter<HoustonCheckbookRecord> {
  return {
    ...houstonCheckbookAdapter,
    source,
  };
}

function record(input: {
  resourceId: string;
  rowId: number;
  revision: string;
  amount: string;
}): HoustonCheckbookRecord {
  return {
    source: {
      packageName: "checkbook",
      resourceId: input.resourceId,
      resourceName: "Checkbook 2026",
      resourceRevision: input.revision,
      resourceModifiedAt: "2026-07-12T03:48:04.764178Z",
      resourceUrl: `https://data.houstontx.gov/resource/${input.resourceId}/checkbook-2026.csv`,
    },
    row: {
      _id: input.rowId,
      "Payment Document Number": `DOC-${input.rowId}`,
      "Fund ID": "1000",
      "Fund Name": "General Fund",
      "Department ID": "2000",
      "Department Name": "Houston Public Works",
      "WBS ID": "",
      "WBS Description": "",
      "GL Account Number": "520128",
      "GL Account Description": "Fixture services",
      "Vendor Name": "FIXTURE VENDOR LLC",
      "Vendor Invoice": `INV-${input.rowId}`,
      "Fiscal Year": "2026",
      "Clearing Date": "08/22/2025",
      Amount: input.amount,
      "Type of procurement": "Vendor Invoice",
      "Purchase Order Number": `PO-${input.rowId}`,
      "Purchase Order Item": "00010",
      "Contract Number": `CON-${input.rowId}`,
    },
  };
}

function context(resourceId: string, revision: string) {
  return {
    agency: "City of Houston",
    canonicalUrl: "https://data.houstontx.gov/dataset/checkbook",
    sourceFile: {
      id: resourceId,
      revision,
      publishedAt: new Date("2026-07-12T03:48:04.764Z"),
      metadata: {
        packageName: "checkbook",
        resourceName: "Checkbook 2026",
        fiscalYear: 2026,
      },
    },
  };
}

async function cleanup(source: string, runIds: string[]) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      DELETE FROM historical_procurement_records
      WHERE id IN (
        SELECT hpsr.historical_procurement_record_id
        FROM historical_procurement_source_records hpsr
        INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
        WHERE sr.source = ${source}
      )
    `;
    await sql`DELETE FROM source_records WHERE source = ${source}`;
    for (const runId of runIds) {
      await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "Houston Checkbook persistence is idempotent and reconciles a corrected source file without duplicating the canonical payment",
  { skip: !canRun },
  async () => {
    const fixture = identity();
    const sourceAdapter = adapter(fixture.source);
    const runIds: string[] = [];

    try {
      const runOne = await startIngestionRun({
        source: fixture.source,
        scope: "backfill",
        agency: "City of Houston",
      });
      runIds.push(runOne);
      const first = await persistHistoricalProcurementSourceRecord({
        adapter: sourceAdapter,
        runId: runOne,
        record: record({
          resourceId: fixture.resourceId,
          rowId: 17,
          revision: "hash-v1",
          amount: "100.00",
        }),
        context: context(fixture.resourceId, "hash-v1"),
      });
      assert.equal(first.change, "inserted");

      const runTwo = await startIngestionRun({
        source: fixture.source,
        scope: "backfill",
        agency: "City of Houston",
      });
      runIds.push(runTwo);
      const replay = await persistHistoricalProcurementSourceRecord({
        adapter: sourceAdapter,
        runId: runTwo,
        record: record({
          resourceId: fixture.resourceId,
          rowId: 17,
          revision: "hash-v1",
          amount: "100.00",
        }),
        context: context(fixture.resourceId, "hash-v1"),
      });
      assert.equal(replay.change, "unchanged");
      assert.equal(
        replay.records[0]?.historicalProcurementRecordId,
        first.records[0]?.historicalProcurementRecordId,
      );

      const runThree = await startIngestionRun({
        source: fixture.source,
        scope: "backfill",
        agency: "City of Houston",
      });
      runIds.push(runThree);
      const corrected = await persistHistoricalProcurementSourceRecord({
        adapter: sourceAdapter,
        runId: runThree,
        record: record({
          resourceId: fixture.resourceId,
          rowId: 17,
          revision: "hash-v2",
          amount: "175.50",
        }),
        context: context(fixture.resourceId, "hash-v2"),
      });
      assert.equal(corrected.change, "updated");
      assert.equal(
        corrected.records[0]?.historicalProcurementRecordId,
        first.records[0]?.historicalProcurementRecordId,
      );

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [row] = await sql<{
          count: number;
          amount: string;
          source_file_revision: string;
          source_revision_id: string;
        }[]>`
          SELECT
            count(*) OVER ()::int AS count,
            hpr.amount::text AS amount,
            hpsr.source_file_revision,
            sr.source_revision_id
          FROM historical_procurement_records hpr
          INNER JOIN historical_procurement_source_records hpsr
            ON hpsr.historical_procurement_record_id = hpr.id
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${fixture.source}
        `;

        assert.deepEqual(row, {
          count: 1,
          amount: "175.50",
          source_file_revision: "hash-v2",
          source_revision_id: "hash-v2",
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(fixture.source, runIds);
    }
  },
);

test(
  "Houston Checkbook batch isolation preserves malformed raw evidence while valid neighboring payments persist",
  { skip: !canRun },
  async () => {
    const fixture = identity();
    const sourceAdapter = adapter(fixture.source);
    const runId = await startIngestionRun({
      source: fixture.source,
      scope: "backfill",
      agency: "City of Houston",
    });

    try {
      const valid = record({
        resourceId: fixture.resourceId,
        rowId: 21,
        revision: "hash-v1",
        amount: "25.00",
      });
      const malformed = record({
        resourceId: fixture.resourceId,
        rowId: 22,
        revision: "hash-v1",
        amount: "not-an-amount",
      });

      const result = await persistHistoricalProcurementBatch({
        adapter: sourceAdapter,
        runId,
        records: [valid, malformed],
        context: context(fixture.resourceId, "hash-v1"),
        pageNumber: 7,
      });

      assert.deepEqual(result, {
        processed: 2,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        errors: 1,
      });

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const rows = await sql<{
          source_record_id: string;
          raw_amount: string;
          historical_count: number;
        }[]>`
          SELECT
            sr.source_record_id,
            sr.raw_payload->>'Amount' AS raw_amount,
            count(hpsr.id)::int AS historical_count
          FROM source_records sr
          LEFT JOIN historical_procurement_source_records hpsr
            ON hpsr.source_record_id = sr.id
          WHERE sr.source = ${fixture.source}
          GROUP BY sr.source_record_id, sr.raw_payload
          ORDER BY sr.source_record_id
        `;
        const [errorCount] = await sql<{ count: number; page_number: number }[]>`
          SELECT count(*)::int AS count, min(page_number)::int AS page_number
          FROM ingestion_record_errors
          WHERE ingestion_run_id = ${runId}
            AND stage = 'historical_normalize'
        `;

        assert.deepEqual([...rows], [
          {
            source_record_id: `${fixture.resourceId}:21`,
            raw_amount: "25.00",
            historical_count: 1,
          },
          {
            source_record_id: `${fixture.resourceId}:22`,
            raw_amount: "not-an-amount",
            historical_count: 0,
          },
        ]);
        assert.equal(errorCount?.count, 1);
        assert.equal(errorCount?.page_number, 7);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(fixture.source, [runId]);
    }
  },
);
