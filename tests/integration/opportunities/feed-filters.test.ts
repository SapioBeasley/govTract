import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { getOpportunityFeed } from "@/lib/opportunities/feed";
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
    localSource: `read-filter-local-${suffix}`,
    localRunAgency: `read-filter-local-agency-${suffix}`,
    federalRunAgency: `read-filter-federal-agency-${suffix}`,
    agencyName: `Read Filter Agency ${suffix}`,
    localAgencySlug: `read-filter-local-slug-${suffix}`,
    federalAgencySlug: `read-filter-federal-slug-${suffix}`,
  };
}

function record(input: {
  sourceRecordId: string;
  agencyName: string;
  agencySlug: string;
  title: string;
  status: string;
  opportunityType: string;
  location: Record<string, unknown>;
  publishedAt: Date;
  dueAt: Date;
  naics: string;
}): PersistableOpportunityRecord {
  return {
    sourceRecordId: input.sourceRecordId,
    sourceRevisionId: "1",
    canonicalUrl: `https://example.invalid/opportunities/${input.sourceRecordId}`,
    rawPayload: { id: input.sourceRecordId, title: input.title },
    solicitationNumber: `FILTER-${input.sourceRecordId}`,
    title: input.title,
    description: "Feed filter regression fixture",
    status: input.status,
    sourceStatus: "published",
    opportunityType: input.opportunityType,
    agencyName: input.agencyName,
    agencySlug: input.agencySlug,
    departments: ["Procurement"],
    categories: ["Testing"],
    classifications: [
      {
        sourceClassificationKey: `naics:${input.naics}`,
        scheme: "NAICS",
        code: input.naics,
        name: `NAICS ${input.naics}`,
        sourceMetadata: {},
      },
    ],
    publishedAt: input.publishedAt,
    dueAt: input.dueAt,
    location: input.location,
    documents: [],
  };
}

async function persistOpportunity(input: {
  runId: string;
  source: string;
  runAgency: string;
  opportunity: PersistableOpportunityRecord;
}) {
  const sourceRecord = await persistSourceRecord({
    runId: input.runId,
    source: input.source,
    agency: input.runAgency,
    record: input.opportunity,
  });
  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: sourceRecord.sourceRecordPk,
    record: input.opportunity,
    sourceAuthority: "authoritative",
  });
}

async function cleanup(input: {
  localSource: string;
  localRunAgency: string;
  federalRunAgency: string;
  agencySlugs: string[];
  runIds: string[];
}) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      DELETE FROM source_records
      WHERE (source = ${input.localSource} AND source_agency = ${input.localRunAgency})
         OR (source = 'sam' AND source_agency = ${input.federalRunAgency})
    `;
    for (const agencySlug of input.agencySlugs) {
      await sql`DELETE FROM agencies WHERE slug = ${agencySlug}`;
    }
    for (const runId of input.runIds) {
      await sql`DELETE FROM ingestion_runs WHERE id = ${runId}`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "feed filters geography, date windows, status, type, NAICS, and federal/local level",
  { skip: !canRun },
  async () => {
    const ids = identity();
    const localRun = await startIngestionRun({
      source: ids.localSource,
      scope: "all",
      agency: ids.localRunAgency,
    });
    const federalRun = await startIngestionRun({
      source: "sam",
      scope: "all",
      agency: ids.federalRunAgency,
    });
    const now = Date.now();

    try {
      await persistOpportunity({
        runId: localRun,
        source: ids.localSource,
        runAgency: ids.localRunAgency,
        opportunity: record({
          sourceRecordId: `houston-local-${ids.localRunAgency}`,
          agencyName: ids.agencyName,
          agencySlug: ids.localAgencySlug,
          title: "Houston local filter target",
          status: "open",
          opportunityType: "bid",
          location: { locality: "Houston", region: "TX", country: "US" },
          publishedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
          dueAt: new Date(now + 5 * 24 * 60 * 60 * 1000),
          naics: "237110",
        }),
      });

      await persistOpportunity({
        runId: localRun,
        source: ids.localSource,
        runAgency: ids.localRunAgency,
        opportunity: record({
          sourceRecordId: `austin-local-${ids.localRunAgency}`,
          agencyName: ids.agencyName,
          agencySlug: ids.localAgencySlug,
          title: "Austin local control fixture",
          status: "reviewing",
          opportunityType: "rfp",
          location: { locality: "Austin", region: "TX", country: "US" },
          publishedAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
          dueAt: new Date(now + 40 * 24 * 60 * 60 * 1000),
          naics: "541330",
        }),
      });

      await persistOpportunity({
        runId: federalRun,
        source: "sam",
        runAgency: ids.federalRunAgency,
        opportunity: record({
          sourceRecordId: `federal-${ids.federalRunAgency}`,
          agencyName: ids.agencyName,
          agencySlug: ids.federalAgencySlug,
          title: "Federal filter target",
          status: "open",
          opportunityType: "solicitation",
          location: { locality: "Houston", region: "TX", country: "US" },
          publishedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
          dueAt: new Date(now + 10 * 24 * 60 * 60 * 1000),
          naics: "237310",
        }),
      });

      const geography = await getOpportunityFeed({
        market: "all",
        agency: ids.agencyName,
        geography: "Austin",
        pageSize: 20,
      });
      assert.deepEqual(geography.items.map((item) => item.title), ["Austin local control fixture"]);

      const deadline = await getOpportunityFeed({
        market: "all",
        source: ids.localSource,
        deadlineDays: 7,
        pageSize: 20,
      });
      assert.deepEqual(deadline.items.map((item) => item.title), ["Houston local filter target"]);

      const posted = await getOpportunityFeed({
        market: "all",
        source: ids.localSource,
        postedDays: 7,
        pageSize: 20,
      });
      assert.deepEqual(posted.items.map((item) => item.title), ["Houston local filter target"]);

      const status = await getOpportunityFeed({
        market: "all",
        source: ids.localSource,
        status: "reviewing",
        pageSize: 20,
      });
      assert.deepEqual(status.items.map((item) => item.title), ["Austin local control fixture"]);

      const type = await getOpportunityFeed({
        market: "all",
        source: ids.localSource,
        opportunityType: "bid",
        pageSize: 20,
      });
      assert.deepEqual(type.items.map((item) => item.title), ["Houston local filter target"]);

      const naics = await getOpportunityFeed({
        market: "all",
        source: ids.localSource,
        naics: "2371",
        pageSize: 20,
      });
      assert.deepEqual(naics.items.map((item) => item.title), ["Houston local filter target"]);

      const federal = await getOpportunityFeed({
        market: "all",
        agency: ids.agencyName,
        level: "federal",
        pageSize: 20,
      });
      assert.deepEqual(federal.items.map((item) => item.title), ["Federal filter target"]);

      const local = await getOpportunityFeed({
        market: "all",
        agency: ids.agencyName,
        level: "local",
        pageSize: 20,
      });
      assert.deepEqual(
        new Set(local.items.map((item) => item.title)),
        new Set(["Houston local filter target", "Austin local control fixture"]),
      );
    } finally {
      await cleanup({
        localSource: ids.localSource,
        localRunAgency: ids.localRunAgency,
        federalRunAgency: ids.federalRunAgency,
        agencySlugs: [ids.localAgencySlug, ids.federalAgencySlug],
        runIds: [localRun, federalRun],
      });
    }
  },
);
