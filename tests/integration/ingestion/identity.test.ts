import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { persistProcurementSourceRecord } from "@/lib/procurement/ingestion/adapter";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import type { ProcurementSourceAdapter } from "@/lib/procurement/sources/adapter";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

interface FixtureRecord extends Record<string, unknown> {
  id: string;
  revision: string;
  title: string;
  solicitationNumber?: string | null;
  agencySlug?: string | null;
  agencyName?: string | null;
  issueAt?: string | null;
  dueAt?: string | null;
  publishedAt?: string | null;
  location?: Record<string, unknown>;
  documentChecksum?: string | null;
}

function identity(label: string) {
  sequence += 1;
  return `${label}-${process.pid}-${Date.now()}-${sequence}`;
}

function fixtureAdapter(source: string): ProcurementSourceAdapter<FixtureRecord> {
  return {
    source,
    identify(record) {
      return {
        sourceRecordId: record.id.trim().toLowerCase(),
        sourceRevisionId: record.revision,
      };
    },
    toSourceRecord(record, context) {
      return {
        sourceRecordId: record.id.trim().toLowerCase(),
        sourceRevisionId: record.revision,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
      };
    },
    normalizeOpportunity(record, context) {
      return {
        sourceRecordId: record.id.trim().toLowerCase(),
        sourceRevisionId: record.revision,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
        solicitationNumber: record.solicitationNumber ?? null,
        title: record.title,
        status: context.canonicalStatus ?? null,
        agencyName: record.agencyName ?? null,
        agencySlug: record.agencySlug ?? context.agency ?? null,
        issueAt: record.issueAt ? new Date(record.issueAt) : null,
        dueAt: record.dueAt ? new Date(record.dueAt) : null,
        publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
        location: record.location ?? {},
        departments: [],
        categories: [],
        documents: record.documentChecksum
          ? [
              {
                sourceDocumentKey: `${source}:${record.id}:scope.pdf`,
                name: "scope.pdf",
                mimeType: "application/pdf",
                checksumSha256: record.documentChecksum,
                retrievedAt: new Date("2026-09-10T00:00:00Z"),
                sourceMetadata: { fixture: true },
              },
            ]
          : [],
      };
    },
  };
}

async function cleanup(input: {
  sources: string[];
  agencies: string[];
  runIds: string[];
}) {
  await closeDb();
  if (!process.env.DATABASE_URL) return;

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    for (const source of input.sources) {
      await sql`DELETE FROM source_records WHERE source = ${source}`;
    }
    for (const runId of input.runIds) {
      await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
    }
    for (const agency of input.agencies) {
      await sql`DELETE FROM agencies WHERE slug = ${agency}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "agency + solicitation identity links two raw source records to one canonical opportunity",
  { skip: !canRun },
  async () => {
    const sourceA = identity("identity-beacon");
    const sourceB = identity("identity-sam");
    const agency = identity("identity-agency");
    const runA = await startIngestionRun({ source: sourceA, scope: "open", agency });
    const runB = await startIngestionRun({ source: sourceB, scope: "open", agency });
    const runIds = [runA, runB];
    const rawA: FixtureRecord = {
      id: "BEACON-100",
      revision: "1",
      title: "Downtown Water Main Rehabilitation",
      solicitationNumber: "ITB-2026-001",
      agencySlug: agency,
      agencyName: "City of Houston",
      issueAt: "2026-09-01T15:00:00Z",
      dueAt: "2026-10-20T19:00:00Z",
      location: { locality: "Houston", region: "TX", country: "US" },
      documentChecksum: "a".repeat(64),
      providerOnlyField: { source: "beacon", preserved: true },
    };
    const rawB: FixtureRecord = {
      id: "SAM-200",
      revision: "7",
      title: "Water Main Rehabilitation - Downtown",
      solicitationNumber: "itb 2026/001",
      agencySlug: agency,
      agencyName: "City of Houston",
      issueAt: "2026-09-01T15:30:00Z",
      dueAt: "2026-10-20T19:00:00Z",
      location: { locality: "Houston", region: "TX", country: "US" },
      documentChecksum: "a".repeat(64),
      providerOnlyField: { source: "sam", preserved: true },
    };

    try {
      const first = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(sourceA),
        runId: runA,
        record: rawA,
        context: {
          agency,
          canonicalStatus: "open",
          canonicalUrl: "https://example.invalid/beacon-100",
        },
      });
      const second = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(sourceB),
        runId: runB,
        record: rawB,
        context: {
          agency,
          canonicalStatus: "open",
          canonicalUrl: "https://example.invalid/sam-200",
        },
      });

      assert.equal(second.canonicalOpportunityId, first.canonicalOpportunityId);
      assert.equal(second.identityResolution.kind, "match");
      if (second.identityResolution.kind === "match") {
        assert.equal(second.identityResolution.method, "agency_solicitation");
      }

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [counts] = await sql<{
          source_records: number;
          canonical_opportunities: number;
          source_links: number;
        }[]>`
          SELECT
            (SELECT count(*)::int FROM source_records
              WHERE source = ${sourceA} OR source = ${sourceB}) AS source_records,
            (SELECT count(DISTINCT osr.opportunity_id)::int
              FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${sourceA} OR sr.source = ${sourceB}) AS canonical_opportunities,
            (SELECT count(*)::int
              FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${sourceA} OR sr.source = ${sourceB}) AS source_links
        `;
        assert.deepEqual(counts, {
          source_records: 2,
          canonical_opportunities: 1,
          source_links: 2,
        });

        const rawRows = await sql<{ source: string; raw_payload: Record<string, unknown> }[]>`
          SELECT source, raw_payload
          FROM source_records
          WHERE source = ${sourceA} OR source = ${sourceB}
          ORDER BY source
        `;
        assert.equal(rawRows.length, 2);
        const bySource = new Map(rawRows.map((row) => [row.source, row.raw_payload]));
        assert.deepEqual(bySource.get(sourceA), rawA);
        assert.deepEqual(bySource.get(sourceB), rawB);

        const links = await sql<{
          source: string;
          is_primary: boolean;
          link_method: string;
          confidence: number | null;
          evidence: Record<string, unknown>;
        }[]>`
          SELECT sr.source, osr.is_primary, osr.link_method, osr.confidence, osr.evidence
          FROM opportunity_source_records osr
          JOIN source_records sr ON sr.id = osr.source_record_id
          WHERE sr.source = ${sourceA} OR sr.source = ${sourceB}
          ORDER BY sr.source
        `;
        const linksBySource = new Map(links.map((row) => [row.source, row]));
        assert.equal(linksBySource.get(sourceA)?.is_primary, true);
        assert.equal(linksBySource.get(sourceA)?.link_method, "direct");
        assert.equal(linksBySource.get(sourceB)?.is_primary, false);
        assert.equal(linksBySource.get(sourceB)?.link_method, "agency_solicitation");
        assert.ok((linksBySource.get(sourceB)?.confidence ?? 0) >= 95);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup({ sources: [sourceA, sourceB], agencies: [agency], runIds });
    }
  },
);

test(
  "ambiguous composite candidates stay separate and preserve reviewable identity evidence",
  { skip: !canRun },
  async () => {
    const sourceA = identity("identity-phase-a");
    const sourceC = identity("identity-phase-c");
    const sourceB = identity("identity-aggregate");
    const agency = identity("identity-ambiguous-agency");
    const runA = await startIngestionRun({ source: sourceA, scope: "open", agency });
    const runC = await startIngestionRun({ source: sourceC, scope: "open", agency });
    const runB = await startIngestionRun({ source: sourceB, scope: "open", agency });
    const runIds = [runA, runC, runB];
    const common = {
      agencySlug: agency,
      agencyName: "City of Houston",
      issueAt: "2026-09-15T15:00:00Z",
      dueAt: "2026-11-01T20:00:00Z",
      location: { locality: "Houston", region: "TX", country: "US" },
    };

    try {
      const phaseOne = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(sourceA),
        runId: runA,
        record: {
          id: "PHASE-ONE",
          revision: "1",
          title: "Downtown Storm Sewer Rehabilitation Phase One",
          solicitationNumber: "DRAIN-100-A",
          ...common,
        },
        context: { agency, canonicalStatus: "open", canonicalUrl: "https://example.invalid/phase-one" },
      });
      const phaseTwo = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(sourceC),
        runId: runC,
        record: {
          id: "PHASE-TWO",
          revision: "1",
          title: "Downtown Storm Sewer Rehabilitation Phase Two",
          solicitationNumber: "DRAIN-100-B",
          ...common,
        },
        context: { agency, canonicalStatus: "open", canonicalUrl: "https://example.invalid/phase-two" },
      });
      const aggregate = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(sourceB),
        runId: runB,
        record: {
          id: "AGGREGATE",
          revision: "1",
          title: "Downtown Storm Sewer Rehabilitation",
          solicitationNumber: null,
          ...common,
        },
        context: { agency, canonicalStatus: "open", canonicalUrl: "https://example.invalid/aggregate" },
      });

      assert.notEqual(phaseOne.canonicalOpportunityId, phaseTwo.canonicalOpportunityId);
      assert.notEqual(aggregate.canonicalOpportunityId, phaseOne.canonicalOpportunityId);
      assert.notEqual(aggregate.canonicalOpportunityId, phaseTwo.canonicalOpportunityId);
      assert.equal(aggregate.identityResolution.kind, "ambiguous");
      if (aggregate.identityResolution.kind === "ambiguous") {
        assert.ok(aggregate.identityResolution.candidates.length >= 2);
      }

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [counts] = await sql<{ opportunities: number; source_records: number; source_links: number }[]>`
          SELECT
            (SELECT count(DISTINCT osr.opportunity_id)::int
              FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${sourceA} OR sr.source = ${sourceB} OR sr.source = ${sourceC}) AS opportunities,
            (SELECT count(*)::int FROM source_records
              WHERE source = ${sourceA} OR source = ${sourceB} OR source = ${sourceC}) AS source_records,
            (SELECT count(*)::int
              FROM opportunity_source_records osr
              JOIN source_records sr ON sr.id = osr.source_record_id
              WHERE sr.source = ${sourceA} OR sr.source = ${sourceB} OR sr.source = ${sourceC}) AS source_links
        `;
        assert.deepEqual(counts, { opportunities: 3, source_records: 3, source_links: 3 });

        const [aggregateLink] = await sql<{
          link_method: string;
          is_primary: boolean;
          evidence: Record<string, unknown>;
        }[]>`
          SELECT osr.link_method, osr.is_primary, osr.evidence
          FROM opportunity_source_records osr
          JOIN source_records sr ON sr.id = osr.source_record_id
          WHERE sr.source = ${sourceB}
        `;
        assert.equal(aggregateLink?.link_method, "direct");
        assert.equal(aggregateLink?.is_primary, true);
        const identityEvidence = aggregateLink?.evidence.identityResolution as
          | { kind?: string; candidates?: unknown[] }
          | undefined;
        assert.equal(identityEvidence?.kind, "ambiguous");
        assert.ok((identityEvidence?.candidates?.length ?? 0) >= 2);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup({
        sources: [sourceA, sourceB, sourceC],
        agencies: [agency],
        runIds,
      });
    }
  },
);
