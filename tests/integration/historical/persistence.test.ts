import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import {
  persistHistoricalProcurementBatch,
  persistHistoricalProcurementSourceRecord,
} from "@/lib/procurement/historical/persistence";
import type {
  HistoricalProcurementSourceAdapter,
  HistoricalProcurementSourceContext,
} from "@/lib/procurement/historical/adapter";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

type FixtureRecord = Record<string, unknown> & {
  id: string;
  revision: string;
  kind: "payment" | "award";
  amount?: string | null;
  vendor?: string | null;
  malformed?: boolean;
};

function identity(label: string) {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `historical-${label}-${suffix}`,
    agency: `historical-${label}-agency-${suffix}`,
  };
}

function fixtureAdapter(source: string): HistoricalProcurementSourceAdapter<FixtureRecord> {
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
        sourceAgency: context.agency ?? null,
        canonicalUrl: context.canonicalUrl ?? null,
        rawPayload: record,
      };
    },
    normalize(record) {
      if (record.malformed) {
        throw new Error(`fixture historical normalization failed for ${record.id}`);
      }

      return [
        {
          sourceFactKey: "primary",
          recordType: record.kind,
          title: record.kind === "payment" ? "Houston payment" : "Houston award",
          description: null,
          occurredAt: new Date("2026-01-15T00:00:00.000Z"),
          fiscalYear: 2026,
          monetary:
            record.amount == null
              ? null
              : {
                  type: record.kind === "payment" ? "payment" : "award_amount",
                  amount: record.amount,
                  currency: "USD",
                },
          buyer: {
            name: "Houston Public Works",
            unitName: "Operations",
            sourceNativeId: "HPW",
          },
          vendor:
            record.vendor == null
              ? null
              : {
                  name: record.vendor,
                  sourceNativeId: "VENDOR-1",
                },
          identifiers: [
            { type: "purchase_order", value: "PO-100" },
            { type: "contract", value: "CON-200" },
          ],
          classifications: [
            {
              sourceClassificationKey: "nigp-720-00",
              scheme: "NIGP",
              code: "720-00",
              name: "Pumping Equipment",
              method: "source_provided",
            },
          ],
          metadata: { fixture: true },
          evidence: { sourceField: "fixture" },
        },
      ];
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

function context(agency: string): HistoricalProcurementSourceContext {
  return {
    agency,
    canonicalUrl: "https://example.invalid/historical/record",
    sourceFile: {
      id: "fy2026.csv",
      revision: "sha256:fixture",
      publishedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  };
}

test(
  "historical procurement persists raw evidence before normalization can fail",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("raw-first");
    const runId = await startIngestionRun({ source, scope: "historical", agency });
    const record: FixtureRecord = {
      id: "PAY-1",
      revision: "1",
      kind: "payment",
      amount: "125.00",
      malformed: true,
      providerOnlyField: { preserved: true },
    };

    try {
      await assert.rejects(
        () =>
          persistHistoricalProcurementSourceRecord({
            adapter: fixtureAdapter(source),
            runId,
            record,
            context: context(agency),
          }),
        /fixture historical normalization failed/,
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
        const [historicalCount] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM historical_procurement_source_records hpsr
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${source}
        `;

        assert.equal(sourceRow?.source_record_id, "pay-1");
        assert.deepEqual(sourceRow?.raw_payload, record);
        assert.equal(historicalCount?.count, 0);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, [runId]);
    }
  },
);

test(
  "historical procurement keeps monetary semantics, identifiers, classifications, provenance, and idempotent source updates",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("idempotent");
    const runOne = await startIngestionRun({ source, scope: "historical", agency });
    const runIds = [runOne];
    const adapter = fixtureAdapter(source);
    const firstRecord: FixtureRecord = {
      id: "PAY-2",
      revision: "1",
      kind: "payment",
      amount: "100.00",
      vendor: "Fixture Pump Co",
    };

    try {
      const first = await persistHistoricalProcurementSourceRecord({
        adapter,
        runId: runOne,
        record: firstRecord,
        context: context(agency),
      });
      assert.equal(first.change, "inserted");
      assert.equal(first.records.length, 1);

      const runTwo = await startIngestionRun({ source, scope: "historical", agency });
      runIds.push(runTwo);
      const replay = await persistHistoricalProcurementSourceRecord({
        adapter,
        runId: runTwo,
        record: firstRecord,
        context: context(agency),
      });
      assert.equal(replay.change, "unchanged");
      assert.equal(replay.records[0]?.historicalProcurementRecordId, first.records[0]?.historicalProcurementRecordId);

      const runThree = await startIngestionRun({ source, scope: "historical", agency });
      runIds.push(runThree);
      const corrected = await persistHistoricalProcurementSourceRecord({
        adapter,
        runId: runThree,
        record: {
          ...firstRecord,
          revision: "2",
          amount: "175.50",
        },
        context: context(agency),
      });
      assert.equal(corrected.change, "updated");
      assert.equal(corrected.records[0]?.historicalProcurementRecordId, first.records[0]?.historicalProcurementRecordId);

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [row] = await sql<{
          record_type: string;
          monetary_type: string | null;
          amount: string | null;
          buyer_name: string | null;
          buyer_source_id: string | null;
          vendor_name: string | null;
          vendor_source_id: string | null;
          source_file_id: string | null;
          source_file_revision: string | null;
          source_revision_id: string | null;
        }[]>`
          SELECT
            hpr.record_type,
            hpr.monetary_type,
            hpr.amount::text,
            hpr.buyer_name,
            hpr.buyer_source_id,
            hpr.vendor_name,
            hpr.vendor_source_id,
            hpsr.source_file_id,
            hpsr.source_file_revision,
            sr.source_revision_id
          FROM historical_procurement_records hpr
          INNER JOIN historical_procurement_source_records hpsr
            ON hpsr.historical_procurement_record_id = hpr.id
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${source}
        `;
        const identifiers = await sql<{ identifier_type: string; identifier_value: string }[]>`
          SELECT hpi.identifier_type, hpi.identifier_value
          FROM historical_procurement_identifiers hpi
          INNER JOIN historical_procurement_source_records hpsr
            ON hpsr.historical_procurement_record_id = hpi.historical_procurement_record_id
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${source}
          ORDER BY hpi.identifier_type
        `;
        const classifications = await sql<{ scheme: string; code: string | null; method: string }[]>`
          SELECT hpc.scheme, hpc.code, hpc.method
          FROM historical_procurement_classifications hpc
          INNER JOIN historical_procurement_source_records hpsr
            ON hpsr.historical_procurement_record_id = hpc.historical_procurement_record_id
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${source}
        `;

        assert.deepEqual(row, {
          record_type: "payment",
          monetary_type: "payment",
          amount: "175.50",
          buyer_name: "Houston Public Works",
          buyer_source_id: "HPW",
          vendor_name: "Fixture Pump Co",
          vendor_source_id: "VENDOR-1",
          source_file_id: "fy2026.csv",
          source_file_revision: "sha256:fixture",
          source_revision_id: "2",
        });
        assert.deepEqual([...identifiers], [
          { identifier_type: "contract", identifier_value: "CON-200" },
          { identifier_type: "purchase_order", identifier_value: "PO-100" },
        ]);
        assert.deepEqual([...classifications], [
          { scheme: "NIGP", code: "720-00", method: "source_provided" },
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, runIds);
    }
  },
);

test(
  "historical procurement accepts partial records and isolates malformed records in a batch",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("batch-isolation");
    const runId = await startIngestionRun({ source, scope: "historical", agency });

    try {
      const result = await persistHistoricalProcurementBatch({
        adapter: fixtureAdapter(source),
        runId,
        context: context(agency),
        records: [
          {
            id: "PARTIAL-1",
            revision: "1",
            kind: "payment",
            amount: null,
            vendor: null,
          },
          {
            id: "BROKEN-1",
            revision: "1",
            kind: "award",
            amount: "500.00",
            malformed: true,
          },
        ],
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
        const [partial] = await sql<{
          monetary_type: string | null;
          amount: string | null;
          vendor_name: string | null;
        }[]>`
          SELECT hpr.monetary_type, hpr.amount::text, hpr.vendor_name
          FROM historical_procurement_records hpr
          INNER JOIN historical_procurement_source_records hpsr
            ON hpsr.historical_procurement_record_id = hpr.id
          INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
          WHERE sr.source = ${source} AND sr.source_record_id = 'partial-1'
        `;
        const [errorCount] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM ingestion_record_errors ire
          INNER JOIN ingestion_runs ir ON ir.id = ire.ingestion_run_id
          WHERE ir.id = ${runId} AND ire.stage = 'historical_normalize'
        `;

        assert.deepEqual(partial, {
          monetary_type: null,
          amount: null,
          vendor_name: null,
        });
        assert.equal(errorCount?.count, 1);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, [runId]);
    }
  },
);
