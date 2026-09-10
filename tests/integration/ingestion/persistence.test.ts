import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  hashPayload,
  persistNormalizedOpportunity,
  persistRawIngestionPage,
  persistSourceRecord,
  reconcileIngestionScope,
  recordIngestionRecordError,
  recordPagePersistenceCounts,
  startIngestionRun,
  type PersistableOpportunityRecord,
} from "@/lib/procurement/ingestion/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let testSequence = 0;

function testIdentity(label: string) {
  testSequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${testSequence}`;
  return {
    source: `integration-${label}-${suffix}`,
    agency: `integration-${label}-agency-${suffix}`,
  };
}

function opportunityRecord(input: {
  sourceRecordId: string;
  agency: string;
  revision?: string;
  title?: string;
  rawPayload?: Record<string, unknown>;
}): PersistableOpportunityRecord {
  const rawPayload = input.rawPayload ?? {
    id: input.sourceRecordId,
    revision: input.revision ?? "1",
    title: input.title ?? "Integration opportunity",
  };

  return {
    sourceRecordId: input.sourceRecordId,
    sourceRevisionId: input.revision ?? "1",
    canonicalUrl: `https://example.invalid/opportunities/${input.sourceRecordId}`,
    rawPayload,
    solicitationNumber: `SOL-${input.sourceRecordId}`,
    title: input.title ?? "Integration opportunity",
    description: "Deterministic integration fixture",
    status: "open",
    sourceStatus: "published",
    opportunityType: "bid",
    agencyName: "Integration Test Agency",
    agencySlug: input.agency,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [
      {
        sourceClassificationKey: "nigp:12345",
        scheme: "nigp",
        code: "12345",
        name: "Testing services",
        sourceMetadata: { type: "nigp", code: "12345" },
      },
    ],
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: [
      {
        sourceDocumentKey: "documents/specifications.pdf",
        sourceDocumentId: "doc-1",
        name: "Specifications.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 128,
        checksumSha256: "a".repeat(64),
        retrievedAt: new Date("2026-09-01T13:00:00Z"),
        sourceMetadata: { key: "documents/specifications.pdf", bytes: 128 },
      },
    ],
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
  "replaying an ingestion page does not duplicate the checkpoint row or corrupt run counts",
  { skip: !canRun },
  async () => {
    const { source, agency } = testIdentity("page-replay");
    const runId = await startIngestionRun({ source, scope: "open", agency });

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
        pageNumber: 1,
        counts: { inserted: 2, updated: 0, unchanged: 0 },
      });

      // Simulate a checkpoint replay after an interrupted run.
      await persistRawIngestionPage(page);
      await recordPagePersistenceCounts({
        runId,
        pageNumber: 1,
        counts: { inserted: 2, updated: 0, unchanged: 0 },
      });

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
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
      await cleanup(source, agency, [runId]);
    }
  },
);

test(
  "same-source replay and update preserve canonical identity and downstream idempotency",
  { skip: !canRun },
  async () => {
    const { source, agency } = testIdentity("idempotency");
    const runOne = await startIngestionRun({ source, scope: "open", agency });
    const runIds = [runOne];

    try {
      const original = opportunityRecord({ sourceRecordId: "opp-1", agency });
      const firstSource = await persistSourceRecord({
        runId: runOne,
        source,
        agency,
        record: original,
      });
      assert.equal(firstSource.change, "inserted");
      await persistNormalizedOpportunity({
        source,
        sourceRecordPk: firstSource.sourceRecordPk,
        record: original,
      });

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      let originalOpportunityId: string;
      try {
        const [row] = await sql<{ id: string }[]>`
          SELECT id FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'opp-1'
        `;
        assert.ok(row?.id);
        originalOpportunityId = row.id;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const runTwo = await startIngestionRun({ source, scope: "open", agency });
      runIds.push(runTwo);
      const unchangedSource = await persistSourceRecord({
        runId: runTwo,
        source,
        agency,
        record: original,
      });
      assert.equal(unchangedSource.change, "unchanged");
      assert.equal(unchangedSource.sourceRecordPk, firstSource.sourceRecordPk);
      await persistNormalizedOpportunity({
        source,
        sourceRecordPk: unchangedSource.sourceRecordPk,
        record: original,
      });

      const updatedPayload = { id: "opp-1", revision: "2", title: "Updated opportunity" };
      const updated = opportunityRecord({
        sourceRecordId: "opp-1",
        agency,
        revision: "2",
        title: "Updated opportunity",
        rawPayload: updatedPayload,
      });
      const updatedSource = await persistSourceRecord({
        runId: runTwo,
        source,
        agency,
        record: updated,
      });
      assert.equal(updatedSource.change, "updated");
      assert.equal(updatedSource.sourceRecordPk, firstSource.sourceRecordPk);
      await persistNormalizedOpportunity({
        source,
        sourceRecordPk: updatedSource.sourceRecordPk,
        record: updated,
      });

      const verify = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [sourceRow] = await verify<{
          id: string;
          payload_hash: string;
          raw_payload: Record<string, unknown>;
          source_revision_id: string | null;
          last_ingestion_run_id: string | null;
        }[]>`
          SELECT id, payload_hash, raw_payload, source_revision_id, last_ingestion_run_id
          FROM source_records
          WHERE source = ${source} AND source_record_id = 'opp-1'
        `;
        const [opportunity] = await verify<{ id: string; title: string }[]>`
          SELECT id, title
          FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'opp-1'
        `;
        const [counts] = await verify<{
          source_records: number;
          opportunities: number;
          source_links: number;
          agencies: number;
          documents: number;
          versions: number;
          classifications: number;
        }[]>`
          SELECT
            (SELECT count(*)::int FROM source_records WHERE source = ${source}) AS source_records,
            (SELECT count(*)::int FROM opportunities WHERE source = ${source}) AS opportunities,
            (SELECT count(*)::int FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${source}) AS source_links,
            (SELECT count(*)::int FROM agencies WHERE slug = ${agency}) AS agencies,
            (SELECT count(*)::int FROM opportunity_documents od
              JOIN opportunities o ON o.id = od.opportunity_id
              WHERE o.source = ${source}) AS documents,
            (SELECT count(*)::int FROM opportunity_document_versions odv
              JOIN opportunity_documents od ON od.id = odv.opportunity_document_id
              JOIN opportunities o ON o.id = od.opportunity_id
              WHERE o.source = ${source}) AS versions,
            (SELECT count(*)::int FROM opportunity_classifications oc
              JOIN opportunities o ON o.id = oc.opportunity_id
              WHERE o.source = ${source}) AS classifications
        `;

        assert.equal(sourceRow?.id, firstSource.sourceRecordPk);
        assert.equal(sourceRow?.payload_hash, hashPayload(updatedPayload));
        assert.deepEqual(sourceRow?.raw_payload, updatedPayload);
        assert.equal(sourceRow?.source_revision_id, "2");
        assert.equal(sourceRow?.last_ingestion_run_id, runTwo);
        assert.equal(opportunity?.id, originalOpportunityId);
        assert.equal(opportunity?.title, "Updated opportunity");
        assert.deepEqual(counts, {
          source_records: 1,
          opportunities: 1,
          source_links: 1,
          agencies: 1,
          documents: 1,
          versions: 1,
          classifications: 1,
        });
      } finally {
        await verify.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, runIds);
    }
  },
);

test(
  "record-level failures remain traceable without discarding successful records",
  { skip: !canRun },
  async () => {
    const { source, agency } = testIdentity("record-error");
    const runId = await startIngestionRun({ source, scope: "open", agency });

    try {
      const good = opportunityRecord({ sourceRecordId: "good", agency });
      const persisted = await persistSourceRecord({ runId, source, agency, record: good });
      await persistNormalizedOpportunity({
        source,
        sourceRecordPk: persisted.sourceRecordPk,
        record: good,
      });
      await recordIngestionRecordError({
        runId,
        pageNumber: 1,
        sourceRecordId: "bad",
        stage: "normalization",
        error: "fixture normalization failure",
        rawPayload: { id: "bad", malformed: true },
      });

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [counts] = await sql<{
          source_records: number;
          opportunities: number;
          errors: number;
          run_errors: number;
        }[]>`
          SELECT
            (SELECT count(*)::int FROM source_records WHERE source = ${source}) AS source_records,
            (SELECT count(*)::int FROM opportunities WHERE source = ${source}) AS opportunities,
            (SELECT count(*)::int FROM ingestion_record_errors WHERE ingestion_run_id = ${runId}) AS errors,
            (SELECT record_error_count FROM ingestion_runs WHERE id = ${runId}) AS run_errors
        `;
        assert.deepEqual(counts, {
          source_records: 1,
          opportunities: 1,
          errors: 1,
          run_errors: 1,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, [runId]);
    }
  },
);

test(
  "only complete positive pulls reconcile missing records and archived records reactivate in place",
  { skip: !canRun },
  async () => {
    const { source, agency } = testIdentity("reconciliation");
    const runOne = await startIngestionRun({ source, scope: "open", agency });
    const runIds = [runOne];

    try {
      for (const sourceRecordId of ["present", "missing"]) {
        const record = opportunityRecord({ sourceRecordId, agency });
        const persisted = await persistSourceRecord({ runId: runOne, source, agency, record });
        await persistNormalizedOpportunity({
          source,
          sourceRecordPk: persisted.sourceRecordPk,
          record,
        });
      }

      const before = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      let missingOpportunityId: string;
      try {
        const [missing] = await before<{ id: string }[]>`
          SELECT id FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'missing'
        `;
        assert.ok(missing?.id);
        missingOpportunityId = missing.id;
      } finally {
        await before.end({ timeout: 5 });
      }

      const partialReconciled = await reconcileIngestionScope({
        source,
        agency,
        seenSourceRecordIds: ["present"],
        status: "partial",
        reportedTotal: 2,
        paginationComplete: true,
        normalizationComplete: false,
      });
      assert.equal(partialReconciled, false);

      const afterPartial = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const rows = await afterPartial<{ source_opportunity_id: string; is_active: boolean }[]>`
          SELECT source_opportunity_id, is_active
          FROM opportunities
          WHERE source = ${source}
          ORDER BY source_opportunity_id
        `;
        assert.deepEqual(rows, [
          { source_opportunity_id: "missing", is_active: true },
          { source_opportunity_id: "present", is_active: true },
        ]);
      } finally {
        await afterPartial.end({ timeout: 5 });
      }

      assert.equal(
        await reconcileIngestionScope({
          source,
          agency,
          seenSourceRecordIds: ["present"],
          status: "complete",
          reportedTotal: 0,
          paginationComplete: true,
          normalizationComplete: true,
        }),
        false,
      );

      const completeReconciled = await reconcileIngestionScope({
        source,
        agency,
        seenSourceRecordIds: ["present"],
        status: "complete",
        reportedTotal: 1,
        paginationComplete: true,
        normalizationComplete: true,
      });
      assert.equal(completeReconciled, true);

      const archived = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [row] = await archived<{ opportunity_active: boolean; source_active: boolean }[]>`
          SELECT o.is_active AS opportunity_active, sr.is_active AS source_active
          FROM opportunities o
          JOIN source_records sr ON sr.id = o.source_record_id
          WHERE o.source = ${source} AND o.source_opportunity_id = 'missing'
        `;
        assert.deepEqual(row, { opportunity_active: false, source_active: false });
      } finally {
        await archived.end({ timeout: 5 });
      }

      const runTwo = await startIngestionRun({ source, scope: "open", agency });
      runIds.push(runTwo);
      const reappeared = opportunityRecord({
        sourceRecordId: "missing",
        agency,
        revision: "2",
        title: "Reappeared opportunity",
        rawPayload: { id: "missing", revision: "2", title: "Reappeared opportunity" },
      });
      const persistedAgain = await persistSourceRecord({
        runId: runTwo,
        source,
        agency,
        record: reappeared,
      });
      await persistNormalizedOpportunity({
        source,
        sourceRecordPk: persistedAgain.sourceRecordPk,
        record: reappeared,
      });

      const reactivated = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [row] = await reactivated<{ id: string; is_active: boolean; title: string }[]>`
          SELECT id, is_active, title
          FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'missing'
        `;
        assert.equal(row?.id, missingOpportunityId);
        assert.equal(row?.is_active, true);
        assert.equal(row?.title, "Reappeared opportunity");
      } finally {
        await reactivated.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, runIds);
    }
  },
);
