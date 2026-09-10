import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  persistRawIngestionPage,
  recordPagePersistenceCounts,
  startIngestionRun,
} from "@/lib/procurement/ingestion/persistence";

const canRun = Boolean(process.env.DATABASE_URL);

function testSource() {
  return `integration-test-${process.pid}-${Date.now()}`;
}

test(
  "replaying an ingestion page does not duplicate the checkpoint row or corrupt run counts",
  { skip: !canRun },
  async () => {
    const source = testSource();
    const runId = await startIngestionRun({
      source,
      scope: "open",
      agency: "test-agency",
    });

    try {
      const page = {
        runId,
        pageNumber: 1,
        cursor: { start: 0, pageSize: 2 },
        reportedTotal: 2,
        rawPayload: { data: [{ id: "one" }, { id: "two" }] },
        recordCount: 2,
      };

      await persistRawIngestionPage(page);
      await recordPagePersistenceCounts({
        runId,
        counts: { inserted: 2, updated: 0, unchanged: 0 },
      });

      // Simulate a checkpoint replay after an interrupted run.
      await persistRawIngestionPage(page);
      await recordPagePersistenceCounts({
        runId,
        counts: { inserted: 2, updated: 0, unchanged: 0 },
      });

      const sql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        prepare: false,
      });
      try {
        const [run] = await sql<{
          inserted_count: number;
          updated_count: number;
          unchanged_count: number;
        }[]>`
          SELECT inserted_count, updated_count, unchanged_count
          FROM ingestion_runs
          WHERE id = ${runId}
        `;
        const [pageCount] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM ingestion_run_pages
          WHERE ingestion_run_id = ${runId}
        `;

        assert.equal(pageCount?.count, 1);
        assert.deepEqual(run, {
          inserted_count: 2,
          updated_count: 0,
          unchanged_count: 0,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await closeDb();
      const sql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        prepare: false,
      });
      try {
        await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  },
);
