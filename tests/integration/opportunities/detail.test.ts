import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { getOpportunityDetail } from "@/lib/opportunities/detail";
import {
  persistDocumentExtraction,
  persistDocumentExtractionFailure,
} from "@/lib/procurement/documents/extraction-persistence";
import { prepareExtractionSegments } from "@/lib/procurement/documents/extractions";
import {
  persistNormalizedOpportunity,
  persistSourceRecord,
  startIngestionRun,
  type PersistableOpportunityRecord,
} from "@/lib/procurement/ingestion/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function identity(label: string) {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `read-detail-${label}-${suffix}`,
    agency: `read-detail-${label}-agency-${suffix}`,
  };
}

function documents(staleChecksum: string): NonNullable<PersistableOpportunityRecord["documents"]> {
  return [
    {
      sourceDocumentKey: "pending.pdf",
      sourceDocumentId: "pending",
      name: "pending.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 101,
      checksumSha256: "1".repeat(64),
      retrievedAt: new Date("2026-09-01T13:00:00Z"),
      sourceMetadata: { kind: "pending" },
    },
    {
      sourceDocumentKey: "extracted.pdf",
      sourceDocumentId: "extracted",
      name: "extracted.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 102,
      checksumSha256: "2".repeat(64),
      retrievedAt: new Date("2026-09-01T13:01:00Z"),
      sourceMetadata: { kind: "extracted" },
    },
    {
      sourceDocumentKey: "failed.pdf",
      sourceDocumentId: "failed",
      name: "failed.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 103,
      checksumSha256: "3".repeat(64),
      retrievedAt: new Date("2026-09-01T13:02:00Z"),
      sourceMetadata: { kind: "failed" },
    },
    {
      sourceDocumentKey: "unsupported.zip",
      sourceDocumentId: "unsupported",
      name: "unsupported.zip",
      mimeType: "application/zip",
      fileSizeBytes: 104,
      checksumSha256: "4".repeat(64),
      retrievedAt: new Date("2026-09-01T13:03:00Z"),
      sourceMetadata: { kind: "unsupported" },
    },
    {
      sourceDocumentKey: "stale.pdf",
      sourceDocumentId: "stale",
      name: "stale.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 105,
      checksumSha256: staleChecksum,
      retrievedAt: new Date("2026-09-01T13:04:00Z"),
      sourceMetadata: { kind: "stale" },
    },
    {
      sourceDocumentKey: "inactive.pdf",
      sourceDocumentId: "inactive",
      name: "inactive.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 106,
      checksumSha256: "6".repeat(64),
      retrievedAt: new Date("2026-09-01T13:05:00Z"),
      sourceMetadata: { kind: "inactive" },
    },
  ];
}

function record(input: {
  agency: string;
  revision: string;
  staleChecksum: string;
  includeInactive: boolean;
}): PersistableOpportunityRecord {
  const allDocuments = documents(input.staleChecksum);
  return {
    sourceRecordId: "detail-fixture",
    sourceRevisionId: input.revision,
    canonicalUrl: "https://example.invalid/opportunities/detail-fixture",
    rawPayload: { id: "detail-fixture", revision: input.revision },
    solicitationNumber: "DETAIL-2026-001",
    title: "Opportunity detail regression fixture",
    description: "Detail data should render without AI or derived intelligence.",
    status: "open",
    sourceStatus: "published",
    opportunityType: "bid",
    agencyName: "Detail Regression Agency",
    agencySlug: input.agency,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [
      {
        sourceClassificationKey: "naics:237110",
        scheme: "NAICS",
        code: "237110",
        name: "Water and Sewer Line Construction",
        sourceMetadata: { fixture: true },
      },
    ],
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: input.includeInactive
      ? allDocuments
      : allDocuments.filter((document) => document.sourceDocumentKey !== "inactive.pdf"),
  };
}

async function persistOpportunity(input: {
  runId: string;
  source: string;
  agency: string;
  opportunity: PersistableOpportunityRecord;
}) {
  const sourceRecord = await persistSourceRecord({
    runId: input.runId,
    source: input.source,
    agency: input.agency,
    record: input.opportunity,
  });
  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: sourceRecord.sourceRecordPk,
    record: input.opportunity,
    sourceAuthority: "authoritative",
  });
}

async function lookupState(source: string) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [opportunity] = await sql<{ id: string }[]>`
      SELECT id FROM opportunities
      WHERE source = ${source} AND source_opportunity_id = 'detail-fixture'
    `;
    assert.ok(opportunity?.id);

    const versions = await sql<{
      source_document_key: string;
      document_id: string;
      version_id: string;
      version_number: number;
      checksum_sha256: string | null;
      is_active: boolean;
    }[]>`
      SELECT
        od.source_document_key,
        od.id AS document_id,
        odv.id AS version_id,
        odv.version_number,
        odv.checksum_sha256,
        od.is_active
      FROM opportunity_documents od
      JOIN opportunity_document_versions odv ON odv.opportunity_document_id = od.id
      WHERE od.opportunity_id = ${opportunity.id}
      ORDER BY od.source_document_key, odv.version_number
    `;

    return { opportunityId: opportunity.id, versions };
  } finally {
    await sql.end({ timeout: 5 });
  }
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

test("detail rejects malformed opportunity ids without querying persistence", async () => {
  assert.equal(await getOpportunityDetail("not-a-uuid"), null);
});

test(
  "detail returns null for a well-formed missing opportunity id",
  { skip: !canRun },
  async () => {
    assert.equal(await getOpportunityDetail("00000000-0000-4000-8000-000000000091"), null);
  },
);

test(
  "detail loads source evidence, classifications, active documents, latest versions, and extraction states",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity("states");
    const runId = await startIngestionRun({ source, scope: "all", agency });
    const staleV1 = "5".repeat(64);
    const staleV2 = "7".repeat(64);

    try {
      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ agency, revision: "1", staleChecksum: staleV1, includeInactive: true }),
      });

      const initial = await lookupState(source);
      const versionFor = (key: string) => {
        const match = initial.versions.find(
          (version) => version.source_document_key === key && version.version_number === 1,
        );
        assert.ok(match, `expected version 1 for ${key}`);
        return match.version_id;
      };

      await persistDocumentExtraction({
        documentVersionIds: [versionFor("extracted.pdf")],
        checksumSha256: "2".repeat(64),
        extractorName: "detail-regression",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        sourceByteCount: 102,
        prepared: prepareExtractionSegments([
          { segmentType: "page", locator: { page: 1 }, content: "Extracted fixture text" },
        ]),
      });
      await persistDocumentExtractionFailure({
        documentVersionIds: [versionFor("failed.pdf")],
        checksumSha256: "3".repeat(64),
        extractorName: "detail-regression",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        sourceByteCount: 103,
        failureCode: "extractor_error",
      });
      await persistDocumentExtraction({
        documentVersionIds: [versionFor("stale.pdf")],
        checksumSha256: staleV1,
        extractorName: "detail-regression",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        sourceByteCount: 105,
        prepared: prepareExtractionSegments([
          { segmentType: "page", locator: { page: 1 }, content: "Old stale fixture text" },
        ]),
      });

      await persistOpportunity({
        runId,
        source,
        agency,
        opportunity: record({ agency, revision: "2", staleChecksum: staleV2, includeInactive: false }),
      });

      const state = await lookupState(source);
      const staleVersions = state.versions.filter(
        (version) => version.source_document_key === "stale.pdf",
      );
      assert.deepEqual(
        staleVersions.map((version) => [version.version_number, version.checksum_sha256]),
        [
          [1, staleV1],
          [2, staleV2],
        ],
      );
      assert.equal(
        state.versions.find((version) => version.source_document_key === "inactive.pdf")?.is_active,
        false,
      );

      const detail = await getOpportunityDetail(state.opportunityId);
      assert.ok(detail);
      assert.equal(detail.title, "Opportunity detail regression fixture");
      assert.equal(detail.classifications.length, 1);
      assert.deepEqual(
        detail.classifications.map(({ scheme, code, name }) => ({ scheme, code, name })),
        [{ scheme: "NAICS", code: "237110", name: "Water and Sewer Line Construction" }],
      );
      assert.equal(detail.sourceRecord?.sourceRecordId, "detail-fixture");
      assert.equal(detail.sourceRecord?.sourceRevisionId, "2");

      assert.equal(detail.documents.some((document) => document.sourceDocumentKey === "inactive.pdf"), false);
      assert.equal(detail.documents.length, 5);

      const byKey = new Map(detail.documents.map((document) => [document.sourceDocumentKey, document]));
      assert.equal(byKey.get("pending.pdf")?.extractionState, "pending");
      assert.equal(byKey.get("extracted.pdf")?.extractionState, "extracted");
      assert.equal(byKey.get("extracted.pdf")?.extraction?.status, "extracted");
      assert.equal(byKey.get("failed.pdf")?.extractionState, "failed");
      assert.equal(byKey.get("failed.pdf")?.extraction?.failureCode, "extractor_error");
      assert.equal(byKey.get("unsupported.zip")?.extractionState, "unsupported");
      assert.equal(byKey.get("stale.pdf")?.extractionState, "stale");
      assert.equal(byKey.get("stale.pdf")?.latestVersion?.versionNumber, 2);
      assert.equal(byKey.get("stale.pdf")?.latestVersion?.checksumSha256, staleV2);
      assert.equal(byKey.get("stale.pdf")?.extraction, null);
    } finally {
      await cleanup(source, agency, runId);
    }
  },
);
