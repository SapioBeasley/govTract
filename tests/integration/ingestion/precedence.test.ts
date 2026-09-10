import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { persistProcurementSourceRecord } from "@/lib/procurement/ingestion/adapter";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";
import type {
  ProcurementSourceAdapter,
  ProcurementSourceAuthority,
} from "@/lib/procurement/sources/adapter";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

interface FixtureRecord extends Record<string, unknown> {
  id: string;
  revision: string;
  title: string;
  description?: string | null;
  solicitationNumber: string;
  agencySlug: string;
  agencyName: string;
  status: string;
  issueAt: string;
  dueAt: string;
  location: Record<string, unknown>;
}

function unique(label: string) {
  sequence += 1;
  return `${label}-${process.pid}-${Date.now()}-${sequence}`;
}

function fixtureAdapter(
  source: string,
  authority: ProcurementSourceAuthority,
): ProcurementSourceAdapter<FixtureRecord> {
  return {
    source,
    authority,
    identify(record) {
      return { sourceRecordId: record.id.toLowerCase(), sourceRevisionId: record.revision };
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
      return {
        sourceRecordId: record.id.toLowerCase(),
        sourceRevisionId: record.revision,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
        solicitationNumber: record.solicitationNumber,
        title: record.title,
        description: record.description ?? null,
        status: record.status,
        sourceStatus: record.status,
        opportunityType: "invitation_for_bid",
        agencyName: record.agencyName,
        agencySlug: record.agencySlug,
        departments: [],
        categories: [],
        issueAt: new Date(record.issueAt),
        dueAt: new Date(record.dueAt),
        location: record.location,
      };
    },
  };
}

async function cleanup(input: { sources: string[]; agency: string; runIds: string[] }) {
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
    await sql`DELETE FROM agencies WHERE slug = ${input.agency}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "canonical fields are selected by explicit source precedence instead of last write",
  { skip: !canRun },
  async () => {
    const aggregatorSource = unique("precedence-aggregator");
    const authoritativeSource = unique("precedence-authoritative");
    const agency = unique("precedence-agency");
    const aggregatorRun = await startIngestionRun({
      source: aggregatorSource,
      scope: "open",
      agency,
    });
    const authoritativeRun = await startIngestionRun({
      source: authoritativeSource,
      scope: "open",
      agency,
    });
    const runIds = [aggregatorRun, authoritativeRun];

    const aggregatorV1: FixtureRecord = {
      id: "AGG-100",
      revision: "1",
      title: "Aggregator Water Main Project",
      description: "Aggregator description with useful detail",
      solicitationNumber: "ITB-2026-900",
      agencySlug: agency,
      agencyName: "City of Houston",
      status: "open",
      issueAt: "2026-09-01T15:00:00Z",
      dueAt: "2026-10-20T19:00:00Z",
      location: { locality: "Houston", region: "TX", country: "US" },
      providerOnly: { copy: "aggregator-v1" },
    };
    const authoritative: FixtureRecord = {
      id: "OFFICIAL-200",
      revision: "4",
      title: "Official Water Main Rehabilitation",
      description: null,
      solicitationNumber: "itb 2026/900",
      agencySlug: agency,
      agencyName: "City of Houston",
      status: "open",
      issueAt: "2026-09-01T15:15:00Z",
      dueAt: "2026-10-21T19:00:00Z",
      location: { locality: "Houston", region: "TX", country: "US" },
      providerOnly: { copy: "authoritative" },
    };

    try {
      const first = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(aggregatorSource, "aggregator"),
        runId: aggregatorRun,
        record: aggregatorV1,
        context: {
          agency,
          canonicalStatus: "open",
          canonicalUrl: "https://aggregator.example.invalid/agg-100",
        },
      });
      const second = await persistProcurementSourceRecord({
        adapter: fixtureAdapter(authoritativeSource, "authoritative"),
        runId: authoritativeRun,
        record: authoritative,
        context: {
          agency,
          canonicalStatus: "open",
          canonicalUrl: "https://official.example.invalid/official-200",
        },
      });

      assert.equal(second.canonicalOpportunityId, first.canonicalOpportunityId);

      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [canonical] = await sql<{
          source: string;
          source_opportunity_id: string;
          title: string;
          description: string | null;
          due_at: Date | null;
          canonical_url: string | null;
          field_provenance: Record<string, unknown>;
        }[]>`
          SELECT source, source_opportunity_id, title, description, due_at, canonical_url,
                 field_provenance
          FROM opportunities
          WHERE id = ${first.canonicalOpportunityId}
        `;

        assert.equal(canonical?.source, aggregatorSource);
        assert.equal(canonical?.source_opportunity_id, "agg-100");
        assert.equal(canonical?.title, "Official Water Main Rehabilitation");
        assert.equal(canonical?.description, "Aggregator description with useful detail");
        assert.equal(canonical?.due_at?.toISOString(), "2026-10-21T19:00:00.000Z");
        assert.equal(canonical?.canonical_url, "https://official.example.invalid/official-200");

        const provenance = canonical?.field_provenance as {
          title?: { source?: string; authority?: string };
          description?: { source?: string; authority?: string };
          dueAt?: { source?: string; authority?: string };
        };
        assert.equal(provenance.title?.source, authoritativeSource);
        assert.equal(provenance.title?.authority, "authoritative");
        assert.equal(provenance.description?.source, aggregatorSource);
        assert.equal(provenance.description?.authority, "aggregator");
        assert.equal(provenance.dueAt?.source, authoritativeSource);

        const links = await sql<{
          source: string;
          source_authority: string;
          normalized_payload: Record<string, unknown>;
          raw_payload: Record<string, unknown>;
        }[]>`
          SELECT sr.source, osr.source_authority, osr.normalized_payload, sr.raw_payload
          FROM opportunity_source_records osr
          JOIN source_records sr ON sr.id = osr.source_record_id
          WHERE osr.opportunity_id = ${first.canonicalOpportunityId}
          ORDER BY sr.source
        `;
        assert.equal(links.length, 2);
        const linksBySource = new Map(links.map((row) => [row.source, row]));
        assert.equal(linksBySource.get(aggregatorSource)?.source_authority, "aggregator");
        assert.equal(
          linksBySource.get(authoritativeSource)?.source_authority,
          "authoritative",
        );
        assert.equal(
          linksBySource.get(authoritativeSource)?.normalized_payload.title,
          "Official Water Main Rehabilitation",
        );
        assert.deepEqual(linksBySource.get(aggregatorSource)?.raw_payload, aggregatorV1);
        assert.deepEqual(linksBySource.get(authoritativeSource)?.raw_payload, authoritative);

        const aggregatorV2: FixtureRecord = {
          ...aggregatorV1,
          revision: "2",
          title: "Late aggregator rewrite",
          description: "Updated aggregator-only description",
          dueAt: "2026-10-25T19:00:00Z",
          providerOnly: { copy: "aggregator-v2" },
        };
        const replay = await persistProcurementSourceRecord({
          adapter: fixtureAdapter(aggregatorSource, "aggregator"),
          runId: aggregatorRun,
          record: aggregatorV2,
          context: {
            agency,
            canonicalStatus: "open",
            canonicalUrl: "https://aggregator.example.invalid/agg-100?v=2",
          },
        });
        assert.equal(replay.canonicalOpportunityId, first.canonicalOpportunityId);

        const [afterReplay] = await sql<{
          title: string;
          description: string | null;
          due_at: Date | null;
          canonical_url: string | null;
        }[]>`
          SELECT title, description, due_at, canonical_url
          FROM opportunities
          WHERE id = ${first.canonicalOpportunityId}
        `;
        assert.equal(afterReplay?.title, "Official Water Main Rehabilitation");
        assert.equal(afterReplay?.description, "Updated aggregator-only description");
        assert.equal(afterReplay?.due_at?.toISOString(), "2026-10-21T19:00:00.000Z");
        assert.equal(afterReplay?.canonical_url, "https://official.example.invalid/official-200");
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await cleanup({
        sources: [aggregatorSource, authoritativeSource],
        agency,
        runIds,
      });
    }
  },
);
