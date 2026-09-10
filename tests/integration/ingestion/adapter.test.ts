import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { persistProcurementSourceRecord } from "@/lib/procurement/ingestion/adapter";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import type { ProcurementSourceAdapter } from "@/lib/procurement/sources/adapter";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

type FixtureRecord = Record<string, unknown> & {
  id: string;
  revision: string;
  title: string;
};

function identity(label: string) {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `adapter-${label}-${suffix}`,
    agency: `adapter-${label}-agency-${suffix}`,
  };
}

function fixtureAdapter(source: string, options?: { failNormalization?: boolean }): ProcurementSourceAdapter<FixtureRecord> {
  return {
    source,
    identify(record) {
      return {
        sourceRecordId: record.id.toLowerCase(),
        sourceRevisionId: record.revision,
      };
    },
    toSourceRecord(record, context) {
      return {
        sourceRecordId: record.id.toLowerCase(),
        sourceRevisionId: record.revision,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
      };
    },
    normalizeOpportunity(record, context) {
      if (options?.failNormalization) {
        throw new Error("fixture normalization failure");
      }
      return {
        sourceRecordId: record.id.toLowerCase(),
        sourceRevisionId: record.revision,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
        title: record.title,
        status: context.canonicalStatus ?? null,
        agencyName: "Adapter Test Agency",
        agencySlug: context.agency ?? null,
        departments: [],
        categories: [],
      };
    },
  };
}

async function cleanup(source: string, agency: string, runIds: string[]) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE source = ${source}`;
    await sql`DELETE FROM agencies WHERE slug = ${agency}`;
    for (const runId of runIds) {
      await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "common adapter ingestion persists raw evidence before normalization can fail",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("raw-first");
    const runId = await startIngestionRun({ source, scope: "open", agency });
    const rawRecord: FixtureRecord = {
      id: "SOURCE-1",
      revision: "1",
      title: "Malformed after raw persistence",
      providerOnlyField: { preserved: true },
    };

    try {
      await assert.rejects(
        () =>
          persistProcurementSourceRecord({
            adapter: fixtureAdapter(source, { failNormalization: true }),
            runId,
            record: rawRecord,
            context: {
              agency,
              canonicalStatus: "open",
              canonicalUrl: "https://example.invalid/source-1",
            },
          }),
        /fixture normalization failure/,
      );

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [sourceRow] = await sql<{
          source_record_id: string;
          raw_payload: Record<string, unknown>;
        }[]>`
          SELECT source_record_id, raw_payload
          FROM source_records
          WHERE source = ${source}
        `;
        const [opportunityCount] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM opportunities
          WHERE source = ${source}
        `;

        assert.equal(sourceRow?.source_record_id, "source-1");
        assert.deepEqual(sourceRow?.raw_payload, rawRecord);
        assert.equal(opportunityCount?.count, 0);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, [runId]);
    }
  },
);

test(
  "one source-agnostic adapter flow persists and replays normalized opportunities",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("common-flow");
    const runOne = await startIngestionRun({ source, scope: "open", agency });
    const runIds = [runOne];
    const adapter = fixtureAdapter(source);
    const record: FixtureRecord = {
      id: "SOURCE-2",
      revision: "3",
      title: "Adapter-backed opportunity",
    };
    const context = {
      agency,
      canonicalStatus: "open",
      canonicalUrl: "https://example.invalid/source-2",
    };

    try {
      const first = await persistProcurementSourceRecord({
        adapter,
        runId: runOne,
        record,
        context,
      });
      assert.equal(first.change, "inserted");
      assert.equal(first.identity.sourceRecordId, "source-2");

      const runTwo = await startIngestionRun({ source, scope: "open", agency });
      runIds.push(runTwo);
      const replay = await persistProcurementSourceRecord({
        adapter,
        runId: runTwo,
        record,
        context,
      });
      assert.equal(replay.change, "unchanged");
      assert.equal(replay.sourceRecordPk, first.sourceRecordPk);

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [counts] = await sql<{
          source_records: number;
          opportunities: number;
          source_links: number;
        }[]>`
          SELECT
            (SELECT count(*)::int FROM source_records WHERE source = ${source}) AS source_records,
            (SELECT count(*)::int FROM opportunities WHERE source = ${source}) AS opportunities,
            (SELECT count(*)::int FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${source}) AS source_links
        `;
        assert.deepEqual(counts, {
          source_records: 1,
          opportunities: 1,
          source_links: 1,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, runIds);
    }
  },
);
