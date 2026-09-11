import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  listDocumentCloseoutCandidates,
  queueInactiveDocumentCloseoutBacklog,
  updateDocumentCloseoutStatus,
} from "@/lib/procurement/documents/closeout";
import { persistDocumentExtraction } from "@/lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "@/lib/procurement/documents/extractions";
import {
  persistNormalizedOpportunity,
  persistSourceRecord,
  reconcileIngestionScope,
  startIngestionRun,
  type PersistableOpportunityRecord,
} from "@/lib/procurement/ingestion/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function identity() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `closeout-${suffix}`,
    agency: `closeout-agency-${suffix}`,
  };
}

function record(input: {
  sourceRecordId: string;
  agency: string;
  documents?: PersistableOpportunityRecord["documents"];
}): PersistableOpportunityRecord {
  return {
    sourceRecordId: input.sourceRecordId,
    sourceRevisionId: "1",
    canonicalUrl: `https://example.invalid/opportunities/${input.sourceRecordId}`,
    rawPayload: { id: input.sourceRecordId, status: "published" },
    solicitationNumber: `SOL-${input.sourceRecordId}`,
    title: `Closeout ${input.sourceRecordId}`,
    description: "Inactive document closeout fixture",
    status: "open",
    sourceStatus: "published",
    opportunityType: "bid",
    agencyName: "Closeout Test Agency",
    agencySlug: input.agency,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [],
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: input.documents ?? [],
  };
}

async function persistOpportunity(input: {
  runId: string;
  source: string;
  agency: string;
  opportunity: PersistableOpportunityRecord;
}) {
  const persisted = await persistSourceRecord({
    runId: input.runId,
    source: input.source,
    agency: input.agency,
    record: input.opportunity,
  });
  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: persisted.sourceRecordPk,
    record: input.opportunity,
    sourceAuthority: "authoritative",
  });
}

async function cleanup(source: string, agency: string, runId: string) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE source = ${source}`;
    await sql`DELETE FROM agencies WHERE slug = ${agency}`;
    await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "active to inactive reconciliation queues only unfinished supported document closeout work",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity();
    const runId = await startIngestionRun({ source, scope: "open", agency });

    try {
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({
          sourceRecordId: "closing",
          agency,
          documents: [
            {
              sourceDocumentKey: "documents/pending.pdf",
              name: "pending.pdf",
              mimeType: "application/pdf",
              fileSizeBytes: 256,
              sourceMetadata: { key: "documents/pending.pdf" },
            },
            {
              sourceDocumentKey: "documents/covered.docx",
              name: "covered.docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              fileSizeBytes: 128,
              checksumSha256: "c".repeat(64),
              retrievedAt: new Date("2026-09-01T13:00:00Z"),
              sourceMetadata: { key: "documents/covered.docx" },
            },
            {
              sourceDocumentKey: "documents/unsupported.pptx",
              name: "unsupported.pptx",
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              fileSizeBytes: 64,
              sourceMetadata: { key: "documents/unsupported.pptx" },
            },
          ],
        }),
      });
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ sourceRecordId: "stays-open", agency }),
      });

      const before = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [covered] = await before<{ version_id: string }[]>`
          SELECT odv.id AS version_id
          FROM opportunities o
          JOIN opportunity_documents od ON od.opportunity_id = o.id
          JOIN opportunity_document_versions odv ON odv.opportunity_document_id = od.id
          WHERE o.source = ${source}
            AND o.source_opportunity_id = 'closing'
            AND od.source_document_key = 'documents/covered.docx'
          ORDER BY odv.version_number DESC
          LIMIT 1
        `;
        assert.ok(covered?.version_id);
        await persistDocumentExtraction({
          documentVersionIds: [covered.version_id],
          checksumSha256: "c".repeat(64),
          extractorName: "closeout-fixture",
          extractorVersion: "1",
          sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sourceByteCount: 128,
          prepared: prepareExtractionSegments([
            { segmentType: "section", locator: { index: 1 }, content: "Already extracted" },
          ]),
        });
      } finally {
        await before.end({ timeout: 5 });
      }

      const reconcileInput = {
        source,
        agency,
        seenSourceRecordIds: ["stays-open"],
        status: "complete" as const,
        reportedTotal: 1,
        paginationComplete: true,
        normalizationComplete: true,
      };
      assert.equal(await reconcileIngestionScope(reconcileInput), true);

      const verify = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [opportunity] = await verify<{ is_active: boolean; lifecycle_state: string }[]>`
          SELECT is_active, lifecycle_state
          FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'closing'
        `;
        assert.deepEqual(opportunity, { is_active: false, lifecycle_state: "inactive_unknown" });

        const closeouts = await verify<
          { name: string; status: string; trigger_source: string; completed_at: Date | null }[]
        >`
          SELECT odv.name, dec.status, dec.trigger_source, dec.completed_at
          FROM document_extraction_closeouts dec
          JOIN opportunity_document_versions odv ON odv.id = dec.opportunity_document_version_id
          JOIN opportunities o ON o.id = dec.opportunity_id
          WHERE o.source = ${source} AND o.source_opportunity_id = 'closing'
          ORDER BY odv.name
        `;
        assert.deepEqual(
          closeouts.map((row) => ({
            name: row.name,
            status: row.status,
            triggerSource: row.trigger_source,
            completed: Boolean(row.completed_at),
          })),
          [
            { name: "covered.docx", status: "covered", triggerSource: source, completed: true },
            { name: "pending.pdf", status: "pending", triggerSource: source, completed: false },
            { name: "unsupported.pptx", status: "unsupported", triggerSource: source, completed: true },
          ],
        );

        const candidates = await listDocumentCloseoutCandidates({
          source,
          agency,
          limit: 10,
          retryFailed: false,
        });
        assert.deepEqual(
          candidates.map((candidate) => ({
            name: candidate.name,
            status: candidate.closeoutStatus,
          })),
          [{ name: "pending.pdf", status: "pending" }],
        );

        await updateDocumentCloseoutStatus({
          closeoutId: candidates[0]!.closeoutId,
          status: "failed",
          failureCode: "fixture_failure",
        });
        assert.equal(
          (
            await listDocumentCloseoutCandidates({
              source,
              agency,
              limit: 10,
              retryFailed: false,
            })
          ).length,
          0,
        );
        assert.deepEqual(
          (
            await listDocumentCloseoutCandidates({
              source,
              agency,
              limit: 10,
              retryFailed: true,
            })
          ).map((candidate) => ({ name: candidate.name, status: candidate.closeoutStatus })),
          [{ name: "pending.pdf", status: "failed" }],
        );

        assert.equal(await reconcileIngestionScope(reconcileInput), true);
        const [{ count }] = await verify<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM document_extraction_closeouts dec
          JOIN opportunities o ON o.id = dec.opportunity_id
          WHERE o.source = ${source} AND o.source_opportunity_id = 'closing'
        `;
        assert.equal(count, 3);

        await verify`
          DELETE FROM document_extraction_closeouts
          WHERE opportunity_id IN (
            SELECT id FROM opportunities
            WHERE source = ${source} AND source_opportunity_id = 'closing'
          )
        `;
        const backlog = await queueInactiveDocumentCloseoutBacklog({
          source,
          agency,
          opportunityLimit: 10,
        });
        assert.equal(backlog.opportunitiesScanned, 1);
        assert.deepEqual(
          {
            queued: backlog.queued,
            pending: backlog.pending,
            covered: backlog.covered,
            unsupported: backlog.unsupported,
            failed: backlog.failed,
          },
          { queued: 3, pending: 1, covered: 1, unsupported: 1, failed: 0 },
        );
      } finally {
        await verify.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, runId);
    }
  },
);
