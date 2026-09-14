import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { GET } from "@/app/api/opportunities/[id]/documents/[documentId]/extraction/route";
import { closeDb } from "@/lib/db/client";
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

function identity() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  return {
    source: `read-extraction-route-${suffix}`,
    agency: `read-extraction-route-agency-${suffix}`,
  };
}

function record(agency: string): PersistableOpportunityRecord {
  return {
    sourceRecordId: "route-fixture",
    sourceRevisionId: "1",
    canonicalUrl: "https://example.invalid/opportunities/route-fixture",
    rawPayload: { id: "route-fixture" },
    solicitationNumber: "ROUTE-2026-001",
    title: "Extraction API regression fixture",
    description: "Extraction route fixture",
    status: "open",
    sourceStatus: "published",
    opportunityType: "bid",
    agencyName: "Extraction Route Agency",
    agencySlug: agency,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [],
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: [
      {
        sourceDocumentKey: "extracted.pdf",
        name: "extracted.pdf",
        mimeType: "application/pdf",
        checksumSha256: "a".repeat(64),
        retrievedAt: new Date("2026-09-01T13:00:00Z"),
        sourceMetadata: {},
      },
      {
        sourceDocumentKey: "failed.pdf",
        name: "failed.pdf",
        mimeType: "application/pdf",
        checksumSha256: "b".repeat(64),
        retrievedAt: new Date("2026-09-01T13:01:00Z"),
        sourceMetadata: {},
      },
      {
        sourceDocumentKey: "pending.pdf",
        name: "pending.pdf",
        mimeType: "application/pdf",
        checksumSha256: "c".repeat(64),
        retrievedAt: new Date("2026-09-01T13:02:00Z"),
        sourceMetadata: {},
      },
      {
        sourceDocumentKey: "inactive.pdf",
        name: "inactive.pdf",
        mimeType: "application/pdf",
        checksumSha256: "d".repeat(64),
        retrievedAt: new Date("2026-09-01T13:03:00Z"),
        sourceMetadata: {},
      },
    ],
  };
}

async function persistFixture(input: { runId: string; source: string; agency: string }) {
  const opportunity = record(input.agency);
  const sourceRecord = await persistSourceRecord({
    runId: input.runId,
    source: input.source,
    agency: input.agency,
    record: opportunity,
  });
  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: sourceRecord.sourceRecordPk,
    record: opportunity,
    sourceAuthority: "authoritative",
  });

  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [opportunityRow] = await sql<{ id: string }[]>`
      SELECT id FROM opportunities
      WHERE source = ${input.source} AND source_opportunity_id = 'route-fixture'
    `;
    assert.ok(opportunityRow?.id);

    const documents = await sql<{
      source_document_key: string;
      document_id: string;
      version_id: string;
      checksum_sha256: string | null;
    }[]>`
      SELECT
        od.source_document_key,
        od.id AS document_id,
        odv.id AS version_id,
        odv.checksum_sha256
      FROM opportunity_documents od
      JOIN opportunity_document_versions odv ON odv.opportunity_document_id = od.id
      WHERE od.opportunity_id = ${opportunityRow.id}
        AND odv.version_number = 1
      ORDER BY od.source_document_key
    `;

    const inactive = documents.find((document) => document.source_document_key === "inactive.pdf");
    assert.ok(inactive);
    await sql`UPDATE opportunity_documents SET is_active = false WHERE id = ${inactive.document_id}`;

    return { opportunityId: opportunityRow.id, documents };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function documentFor(
  documents: Awaited<ReturnType<typeof persistFixture>>["documents"],
  key: string,
) {
  const document = documents.find((candidate) => candidate.source_document_key === key);
  assert.ok(document, `expected document ${key}`);
  return document;
}

async function callRoute(input: {
  opportunityId: string;
  documentId: string;
  after?: string;
}) {
  const url = new URL(
    `http://localhost/api/opportunities/${input.opportunityId}/documents/${input.documentId}/extraction`,
  );
  if (input.after !== undefined) url.searchParams.set("after", input.after);
  return GET(new Request(url), {
    params: Promise.resolve({ id: input.opportunityId, documentId: input.documentId }),
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
  "extraction API enforces document ownership and active-document visibility",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity();
    const runId = await startIngestionRun({ source, scope: "all", agency });

    try {
      const fixture = await persistFixture({ runId, source, agency });
      const extracted = documentFor(fixture.documents, "extracted.pdf");
      const inactive = documentFor(fixture.documents, "inactive.pdf");

      const invalid = await callRoute({ opportunityId: "bad-id", documentId: "also-bad" });
      assert.equal(invalid.status, 404);
      assert.deepEqual(await invalid.json(), { error: "Not found" });

      const wrongOwner = await callRoute({
        opportunityId: "00000000-0000-4000-8000-000000000091",
        documentId: extracted.document_id,
      });
      assert.equal(wrongOwner.status, 404);
      assert.deepEqual(await wrongOwner.json(), { error: "Not found" });

      const inactiveResponse = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: inactive.document_id,
      });
      assert.equal(inactiveResponse.status, 404);
      assert.deepEqual(await inactiveResponse.json(), { error: "Not found" });
    } finally {
      await cleanup(source, agency, runId);
    }
  },
);

test(
  "extraction API returns safe pending and failed responses without exposing metadata secrets",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity();
    const runId = await startIngestionRun({ source, scope: "all", agency });

    try {
      const fixture = await persistFixture({ runId, source, agency });
      const pending = documentFor(fixture.documents, "pending.pdf");
      const failed = documentFor(fixture.documents, "failed.pdf");

      await persistDocumentExtractionFailure({
        documentVersionIds: [failed.version_id],
        checksumSha256: "b".repeat(64),
        extractorName: "route-regression",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        failureCode: "source_bytes_unavailable",
        metadata: {
          signedUrl: "https://storage.example.invalid/file?token=super-secret-token",
          apiKey: "do-not-expose-this-key",
        },
      });

      const pendingResponse = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: pending.document_id,
      });
      assert.equal(pendingResponse.status, 200);
      assert.equal(pendingResponse.headers.get("cache-control"), "no-store");
      assert.deepEqual(await pendingResponse.json(), {
        state: "pending",
        segments: [],
        hasMore: false,
        nextCursor: null,
      });

      const failedResponse = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: failed.document_id,
      });
      assert.equal(failedResponse.status, 200);
      assert.equal(failedResponse.headers.get("cache-control"), "no-store");
      const failedBody = await failedResponse.json();
      assert.deepEqual(failedBody, {
        state: "failed",
        message: "The source file needs to be retrieved again before extraction can run.",
        segments: [],
        hasMore: false,
        nextCursor: null,
      });
      const serialized = JSON.stringify(failedBody);
      assert.equal(serialized.includes("super-secret-token"), false);
      assert.equal(serialized.includes("do-not-expose-this-key"), false);
      assert.equal(serialized.includes("storage.example.invalid"), false);
    } finally {
      await cleanup(source, agency, runId);
    }
  },
);

test(
  "extraction API paginates extracted segments with deterministic cursors",
  { skip: !canRun },
  async () => {
    const { source, agency } = identity();
    const runId = await startIngestionRun({ source, scope: "all", agency });

    try {
      const fixture = await persistFixture({ runId, source, agency });
      const extracted = documentFor(fixture.documents, "extracted.pdf");
      const checksum = "a".repeat(64);

      await persistDocumentExtraction({
        documentVersionIds: [extracted.version_id],
        checksumSha256: checksum,
        extractorName: "route-regression",
        extractorVersion: "1",
        sourceMimeType: "application/pdf",
        prepared: prepareExtractionSegments(
          Array.from({ length: 6 }, (_, index) => ({
            segmentType: "page",
            locator: { page: index + 1 },
            content: `Segment ${index + 1}`,
          })),
        ),
      });

      const first = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: extracted.document_id,
      });
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      assert.equal(firstBody.state, "extracted");
      assert.equal(firstBody.versionNumber, 1);
      assert.equal(firstBody.checksumSha256, checksum);
      assert.equal(firstBody.hasMore, true);
      assert.equal(firstBody.nextCursor, 3);
      assert.deepEqual(
        firstBody.segments.map((segment: { ordinal: number; content: string }) => [
          segment.ordinal,
          segment.content,
        ]),
        [
          [0, "Segment 1"],
          [1, "Segment 2"],
          [2, "Segment 3"],
          [3, "Segment 4"],
        ],
      );

      const second = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: extracted.document_id,
        after: String(firstBody.nextCursor),
      });
      const secondBody = await second.json();
      assert.equal(secondBody.state, "extracted");
      assert.equal(secondBody.hasMore, false);
      assert.equal(secondBody.nextCursor, null);
      assert.deepEqual(
        secondBody.segments.map((segment: { ordinal: number; content: string }) => [
          segment.ordinal,
          segment.content,
        ]),
        [
          [4, "Segment 5"],
          [5, "Segment 6"],
        ],
      );

      const invalidCursor = await callRoute({
        opportunityId: fixture.opportunityId,
        documentId: extracted.document_id,
        after: "not-a-number",
      });
      const invalidCursorBody = await invalidCursor.json();
      assert.deepEqual(
        invalidCursorBody.segments.map((segment: { ordinal: number }) => segment.ordinal),
        [0, 1, 2, 3],
      );
    } finally {
      await cleanup(source, agency, runId);
    }
  },
);
