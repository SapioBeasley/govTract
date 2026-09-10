import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { persistProcurementSourceRecord } from "@/lib/procurement/ingestion/adapter";
import {
  createOffsetPaginationState,
  getOffsetPageCursor,
  observeOffsetPaginationPage,
} from "@/lib/procurement/ingestion/offset-pagination";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import {
  getProcurementSourceCapabilities,
  type ProcurementSourceAdapter,
  type ProcurementSourceContext,
} from "@/lib/procurement/sources/adapter";

interface PaginationFixture<TRawRecord> {
  reportedTotal: number;
  records: TRawRecord[];
}

interface ContractDefinition<TRawRecord extends Record<string, unknown>> {
  name: string;
  adapter: ProcurementSourceAdapter<TRawRecord>;
  context: ProcurementSourceContext;
  initial: TRawRecord;
  updated: TRawRecord;
  invalid: TRawRecord;
  expected: {
    sourceRecordId: string;
    initialRevisionId?: string | null;
    updatedRevisionId?: string | null;
    initialTitle: string;
    updatedTitle: string;
  };
  pagination: {
    pageSize: number;
    maxPages: number;
    complete: PaginationFixture<TRawRecord>[];
    repeated: PaginationFixture<TRawRecord>[];
  };
  capabilities: {
    opportunityDetail: boolean;
    documents: boolean;
    amendments: boolean;
  };
  assertUpdatedNormalized?: (record: ReturnType<ProcurementSourceAdapter<TRawRecord>["normalizeOpportunity"]>) => void;
}

const canRunDb = Boolean(process.env.DATABASE_URL);

async function cleanupContractRows(input: {
  source: string;
  sourceRecordId: string;
  agency?: string;
  runIds: string[];
}) {
  await closeDb();
  if (!process.env.DATABASE_URL) return;

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await sql`
      DELETE FROM opportunity_source_records
      WHERE source_record_id IN (
        SELECT id FROM source_records
        WHERE source = ${input.source}
          AND source_record_id = ${input.sourceRecordId}
      )
    `;
    await sql`
      DELETE FROM opportunities
      WHERE source = ${input.source}
        AND source_opportunity_id = ${input.sourceRecordId}
    `;
    await sql`
      DELETE FROM source_records
      WHERE source = ${input.source}
        AND source_record_id = ${input.sourceRecordId}
    `;
    for (const runId of input.runIds) {
      await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
    }
    if (input.agency) {
      await sql`DELETE FROM agencies WHERE slug = ${input.agency}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function defineProcurementSourceAdapterContract<
  TRawRecord extends Record<string, unknown>,
>(definition: ContractDefinition<TRawRecord>) {
  const { adapter } = definition;

  test(`${definition.name}: identity, raw payload, normalization, and optional capabilities`, () => {
    const identity = adapter.identify(definition.initial);
    assert.equal(identity.sourceRecordId, definition.expected.sourceRecordId);
    assert.equal(identity.sourceRevisionId ?? null, definition.expected.initialRevisionId ?? null);

    const sourceRecord = adapter.toSourceRecord(definition.initial, definition.context);
    assert.equal(sourceRecord.sourceRecordId, identity.sourceRecordId);
    assert.deepEqual(sourceRecord.rawPayload, definition.initial);

    const normalized = adapter.normalizeOpportunity(definition.initial, definition.context);
    assert.equal(normalized.sourceRecordId, identity.sourceRecordId);
    assert.equal(normalized.title, definition.expected.initialTitle);
    assert.deepEqual(getProcurementSourceCapabilities(adapter), definition.capabilities);

    assert.throws(() => adapter.identify(definition.invalid));
  });

  test(`${definition.name}: multi-page offset pagination reaches a terminal checkpoint`, () => {
    const state = createOffsetPaginationState();
    let terminal: ReturnType<typeof observeOffsetPaginationPage> | null = null;

    for (const [index, page] of definition.pagination.complete.entries()) {
      const pageNumber = index + 1;
      const cursor = getOffsetPageCursor({
        pageNumber,
        pageSize: definition.pagination.pageSize,
      });
      assert.deepEqual(cursor, {
        start: index * definition.pagination.pageSize,
        pageSize: definition.pagination.pageSize,
      });

      terminal = observeOffsetPaginationPage({
        state,
        pageNumber,
        maxPages: definition.pagination.maxPages,
        reportedTotal: page.reportedTotal,
        sourceRecordIds: page.records.map((record) => adapter.identify(record).sourceRecordId),
      });
    }

    assert.equal(terminal?.status, "complete");
    assert.equal(terminal?.paginationComplete, true);
    assert.equal(terminal?.terminalReason, "total-reached");
    assert.equal(state.seenSourceRecordIds.size, definition.pagination.complete.at(-1)?.reportedTotal);
  });

  test(`${definition.name}: repeated offset page is isolated as partial instead of looping`, () => {
    const state = createOffsetPaginationState();
    let terminal: ReturnType<typeof observeOffsetPaginationPage> | null = null;

    for (const [index, page] of definition.pagination.repeated.entries()) {
      terminal = observeOffsetPaginationPage({
        state,
        pageNumber: index + 1,
        maxPages: definition.pagination.maxPages,
        reportedTotal: page.reportedTotal,
        sourceRecordIds: page.records.map((record) => adapter.identify(record).sourceRecordId),
      });
      if (!terminal.shouldProcessPage) break;
    }

    assert.equal(terminal?.status, "partial");
    assert.equal(terminal?.paginationComplete, false);
    assert.equal(terminal?.terminalReason, "repeated-page-signature");
    assert.equal(terminal?.shouldProcessPage, false);
  });

  test(
    `${definition.name}: persistence is idempotent and updates in place`,
    { skip: !canRunDb },
    async () => {
      const runId = await startIngestionRun({
        source: adapter.source,
        scope: "contract-test",
        agency: definition.context.agency,
      });
      const runIds = [runId];

      try {
        const first = await persistProcurementSourceRecord({
          adapter,
          runId,
          record: definition.initial,
          context: definition.context,
        });
        const replay = await persistProcurementSourceRecord({
          adapter,
          runId,
          record: definition.initial,
          context: definition.context,
        });
        const updated = await persistProcurementSourceRecord({
          adapter,
          runId,
          record: definition.updated,
          context: definition.context,
        });

        assert.equal(first.change, "inserted");
        assert.equal(replay.change, "unchanged");
        assert.equal(updated.change, "updated");
        assert.equal(first.sourceRecordPk, replay.sourceRecordPk);
        assert.equal(first.sourceRecordPk, updated.sourceRecordPk);

        const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
        try {
          const [row] = await sql<{
            opportunity_id: string;
            title: string;
            source_revision_id: string | null;
            raw_payload: Record<string, unknown>;
            source_record_count: number;
            opportunity_count: number;
          }[]>`
            SELECT
              o.id AS opportunity_id,
              o.title,
              sr.source_revision_id,
              sr.raw_payload,
              (SELECT count(*)::int FROM source_records WHERE source = ${adapter.source} AND source_record_id = ${definition.expected.sourceRecordId}) AS source_record_count,
              (SELECT count(*)::int FROM opportunities WHERE source = ${adapter.source} AND source_opportunity_id = ${definition.expected.sourceRecordId}) AS opportunity_count
            FROM opportunities o
            JOIN source_records sr ON sr.id = o.source_record_id
            WHERE o.source = ${adapter.source}
              AND o.source_opportunity_id = ${definition.expected.sourceRecordId}
          `;

          assert.equal(row?.title, definition.expected.updatedTitle);
          assert.equal(row?.source_revision_id, definition.expected.updatedRevisionId ?? null);
          assert.deepEqual(row?.raw_payload, definition.updated);
          assert.equal(row?.source_record_count, 1);
          assert.equal(row?.opportunity_count, 1);
        } finally {
          await sql.end({ timeout: 5 });
        }

        const normalized = adapter.normalizeOpportunity(definition.updated, definition.context);
        definition.assertUpdatedNormalized?.(normalized);
      } finally {
        await cleanupContractRows({
          source: adapter.source,
          sourceRecordId: definition.expected.sourceRecordId,
          agency: definition.context.agency,
          runIds,
        });
      }
    },
  );

  test(
    `${definition.name}: a failed normalization preserves raw evidence and does not poison recovery`,
    { skip: !canRunDb },
    async () => {
      const runId = await startIngestionRun({
        source: adapter.source,
        scope: "contract-test",
        agency: definition.context.agency,
      });
      const failingAdapter: ProcurementSourceAdapter<TRawRecord> = {
        ...adapter,
        normalizeOpportunity() {
          throw new Error("contract normalization failure");
        },
      };

      try {
        await assert.rejects(
          () =>
            persistProcurementSourceRecord({
              adapter: failingAdapter,
              runId,
              record: definition.initial,
              context: definition.context,
            }),
          /contract normalization failure/,
        );

        const recovered = await persistProcurementSourceRecord({
          adapter,
          runId,
          record: definition.initial,
          context: definition.context,
        });
        assert.equal(recovered.change, "unchanged");

        const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
        try {
          const [row] = await sql<{
            raw_payload: Record<string, unknown>;
            opportunity_count: number;
          }[]>`
            SELECT
              sr.raw_payload,
              (SELECT count(*)::int FROM opportunities WHERE source = ${adapter.source} AND source_opportunity_id = ${definition.expected.sourceRecordId}) AS opportunity_count
            FROM source_records sr
            WHERE sr.source = ${adapter.source}
              AND sr.source_record_id = ${definition.expected.sourceRecordId}
          `;
          assert.deepEqual(row?.raw_payload, definition.initial);
          assert.equal(row?.opportunity_count, 1);
        } finally {
          await sql.end({ timeout: 5 });
        }
      } finally {
        await cleanupContractRows({
          source: adapter.source,
          sourceRecordId: definition.expected.sourceRecordId,
          agency: definition.context.agency,
          runIds: [runId],
        });
      }
    },
  );
}
