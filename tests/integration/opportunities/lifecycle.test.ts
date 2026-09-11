import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { getOpportunityDetail } from "@/lib/opportunities/detail";
import { getOpportunityFeed } from "@/lib/opportunities/feed";
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

function identity(label: string) {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `lifecycle-${label}-${suffix}`,
    agency: `lifecycle-${label}-agency-${suffix}`,
  };
}

function record(input: {
  sourceRecordId: string;
  agency: string;
  revision?: string;
  title?: string;
  status?: string;
  sourceStatus?: string;
}): PersistableOpportunityRecord {
  return {
    sourceRecordId: input.sourceRecordId,
    sourceRevisionId: input.revision ?? "1",
    canonicalUrl: `https://example.invalid/opportunities/${input.sourceRecordId}`,
    rawPayload: {
      id: input.sourceRecordId,
      revision: input.revision ?? "1",
      title: input.title ?? input.sourceRecordId,
      status: input.sourceStatus ?? "published",
    },
    solicitationNumber: `SOL-${input.sourceRecordId}`,
    title: input.title ?? `Lifecycle ${input.sourceRecordId}`,
    description: "Lifecycle integration fixture",
    status: input.status ?? "open",
    sourceStatus: input.sourceStatus ?? "published",
    opportunityType: "bid",
    agencyName: "Lifecycle Test Agency",
    agencySlug: input.agency,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [],
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: [
      {
        sourceDocumentKey: `documents/${input.sourceRecordId}.pdf`,
        sourceDocumentId: `doc-${input.sourceRecordId}`,
        name: `${input.sourceRecordId}.pdf`,
        mimeType: "application/pdf",
        fileSizeBytes: 128,
        checksumSha256: "a".repeat(64),
        retrievedAt: new Date("2026-09-01T13:00:00Z"),
        sourceMetadata: { key: `documents/${input.sourceRecordId}.pdf` },
      },
    ],
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
  return persisted;
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
  "source disappearance archives as inactive_unknown while preserving documents and extraction evidence",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("archive");
    const runId = await startIngestionRun({ source, scope: "open", agency });

    try {
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ sourceRecordId: "still-open", agency }),
      });
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ sourceRecordId: "disappeared", agency }),
      });

      const before = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      let archivedOpportunityId = "";
      let documentVersionId = "";
      try {
        const [row] = await before<{ opportunity_id: string; version_id: string }[]>`
          SELECT o.id AS opportunity_id, odv.id AS version_id
          FROM opportunities o
          JOIN opportunity_documents od ON od.opportunity_id = o.id
          JOIN opportunity_document_versions odv ON odv.opportunity_document_id = od.id
          WHERE o.source = ${source} AND o.source_opportunity_id = 'disappeared'
          ORDER BY odv.version_number DESC
          LIMIT 1
        `;
        assert.ok(row?.opportunity_id);
        assert.ok(row?.version_id);
        archivedOpportunityId = row.opportunity_id;
        documentVersionId = row.version_id;
      } finally {
        await before.end({ timeout: 5 });
      }

      await persistDocumentExtraction({
        documentVersionIds: [documentVersionId],
        checksumSha256: "a".repeat(64),
        extractorName: "lifecycle-fixture",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        sourceByteCount: 128,
        prepared: prepareExtractionSegments([
          { segmentType: "page", locator: { page: 1 }, content: "Historical scope evidence" },
        ]),
      });

      const reconcileInput = {
        source,
        agency,
        seenSourceRecordIds: ["still-open"],
        status: "complete" as const,
        reportedTotal: 1,
        paginationComplete: true,
        normalizationComplete: true,
      };
      assert.equal(await reconcileIngestionScope(reconcileInput), true);
      assert.equal(await reconcileIngestionScope(reconcileInput), true);

      const verify = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [archived] = await verify<{
          lifecycle_state: string;
          is_active: boolean;
          status: string | null;
          source_status: string | null;
          source_active: boolean;
          documents: number;
          versions: number;
          extraction_links: number;
        }[]>`
          SELECT
            o.lifecycle_state,
            o.is_active,
            o.status,
            o.source_status,
            sr.is_active AS source_active,
            (SELECT count(*)::int FROM opportunity_documents od WHERE od.opportunity_id = o.id) AS documents,
            (SELECT count(*)::int FROM opportunity_document_versions odv
              JOIN opportunity_documents od ON od.id = odv.opportunity_document_id
              WHERE od.opportunity_id = o.id) AS versions,
            (SELECT count(*)::int FROM opportunity_document_version_extractions odve
              JOIN opportunity_document_versions odv ON odv.id = odve.opportunity_document_version_id
              JOIN opportunity_documents od ON od.id = odv.opportunity_document_id
              WHERE od.opportunity_id = o.id) AS extraction_links
          FROM opportunities o
          JOIN source_records sr ON sr.id = o.source_record_id
          WHERE o.id = ${archivedOpportunityId}
        `;

        assert.deepEqual(archived, {
          lifecycle_state: "inactive_unknown",
          is_active: false,
          status: "open",
          source_status: "published",
          source_active: false,
          documents: 1,
          versions: 1,
          extraction_links: 1,
        });
      } finally {
        await verify.end({ timeout: 5 });
      }

      const feed = await getOpportunityFeed({ market: "all", source, pageSize: 10 });
      assert.equal(feed.total, 1);
      assert.deepEqual(feed.items.map((item) => item.title), ["Lifecycle still-open"]);

      const detail = await getOpportunityDetail(archivedOpportunityId);
      assert.ok(detail);
      assert.equal(detail.lifecycleState, "inactive_unknown");
      assert.equal(detail.isActive, false);
      assert.equal(detail.documents.length, 1);
      assert.equal(detail.documents[0]?.extractionState, "extracted");
    } finally {
      await cleanup(source, agency, [runId]);
    }
  },
);

test(
  "source-provided terminal state is explicit and does not become inactive_unknown on reconciliation",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("terminal");
    const runId = await startIngestionRun({ source, scope: "all", agency });

    try {
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({
          sourceRecordId: "cancelled",
          agency,
          status: "open",
          sourceStatus: "Canceled",
        }),
      });
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ sourceRecordId: "active", agency }),
      });

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [cancelled] = await sql<{
          lifecycle_state: string;
          is_active: boolean;
          source_status: string | null;
        }[]>`
          SELECT lifecycle_state, is_active, source_status
          FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'cancelled'
        `;
        assert.deepEqual(cancelled, {
          lifecycle_state: "cancelled",
          is_active: false,
          source_status: "Canceled",
        });
      } finally {
        await sql.end({ timeout: 5 });
      }

      assert.equal(
        await reconcileIngestionScope({
          source,
          agency,
          seenSourceRecordIds: ["active"],
          status: "complete",
          reportedTotal: 1,
          paginationComplete: true,
          normalizationComplete: true,
        }),
        true,
      );

      const after = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [cancelled] = await after<{
          lifecycle_state: string;
          is_active: boolean;
          source_active: boolean;
        }[]>`
          SELECT o.lifecycle_state, o.is_active, sr.is_active AS source_active
          FROM opportunities o
          JOIN source_records sr ON sr.id = o.source_record_id
          WHERE o.source = ${source} AND o.source_opportunity_id = 'cancelled'
        `;
        assert.deepEqual(cancelled, {
          lifecycle_state: "cancelled",
          is_active: false,
          source_active: false,
        });
      } finally {
        await after.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, [runId]);
    }
  },
);

test(
  "an archived opportunity reappears with the same canonical id and active lifecycle",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("reactivation");
    const firstRun = await startIngestionRun({ source, scope: "open", agency });
    const runIds = [firstRun];

    try {
      await persistOpportunity({
        runId: firstRun,
        source,
        agency,
        opportunity: record({ sourceRecordId: "returning", agency }),
      });
      await persistOpportunity({
        runId: firstRun,
        source,
        agency,
        opportunity: record({ sourceRecordId: "keeper", agency }),
      });

      const initial = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      let opportunityId = "";
      try {
        const [row] = await initial<{ id: string }[]>`
          SELECT id FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'returning'
        `;
        assert.ok(row?.id);
        opportunityId = row.id;
      } finally {
        await initial.end({ timeout: 5 });
      }

      assert.equal(
        await reconcileIngestionScope({
          source,
          agency,
          seenSourceRecordIds: ["keeper"],
          status: "complete",
          reportedTotal: 1,
          paginationComplete: true,
          normalizationComplete: true,
        }),
        true,
      );

      const secondRun = await startIngestionRun({ source, scope: "open", agency });
      runIds.push(secondRun);
      await persistOpportunity({
        runId: secondRun,
        source,
        agency,
        opportunity: record({
          sourceRecordId: "returning",
          agency,
          revision: "2",
          title: "Returned opportunity",
        }),
      });

      const verify = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const rows = await verify<{ id: string; lifecycle_state: string; is_active: boolean }[]>`
          SELECT id, lifecycle_state, is_active
          FROM opportunities
          WHERE source = ${source} AND source_opportunity_id = 'returning'
        `;
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, opportunityId);
        assert.equal(rows[0]?.lifecycle_state, "active");
        assert.equal(rows[0]?.is_active, true);
      } finally {
        await verify.end({ timeout: 5 });
      }
    } finally {
      await cleanup(source, agency, runIds);
    }
  },
);
