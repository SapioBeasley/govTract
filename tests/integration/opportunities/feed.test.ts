import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  getOpportunityFeed,
  getOpportunityFeedFacets,
} from "@/lib/opportunities/feed";
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
    source: `read-feed-${label}-${suffix}`,
    runAgency: `read-feed-run-${label}-${suffix}`,
  };
}

function record(input: {
  sourceRecordId: string;
  agencySlug: string;
  agencyName: string;
  title?: string;
  solicitationNumber?: string;
  description?: string;
  departments?: string[];
  categories?: string[];
  classifications?: PersistableOpportunityRecord["classifications"];
  publishedAt?: Date;
  dueAt?: Date;
}): PersistableOpportunityRecord {
  return {
    sourceRecordId: input.sourceRecordId,
    sourceRevisionId: "1",
    canonicalUrl: `https://example.invalid/opportunities/${input.sourceRecordId}`,
    rawPayload: {
      id: input.sourceRecordId,
      title: input.title ?? input.sourceRecordId,
    },
    solicitationNumber: input.solicitationNumber ?? `SOL-${input.sourceRecordId}`,
    title: input.title ?? `Read ${input.sourceRecordId}`,
    description: input.description ?? "Opportunity read-path fixture",
    status: "open",
    sourceStatus: "published",
    opportunityType: "bid",
    agencyName: input.agencyName,
    agencySlug: input.agencySlug,
    departments: input.departments ?? ["Procurement"],
    categories: input.categories ?? ["Testing"],
    classifications: input.classifications ?? [],
    publishedAt: input.publishedAt ?? new Date("2026-09-01T12:00:00Z"),
    dueAt: input.dueAt ?? new Date("2026-09-30T22:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documents: [],
  };
}

async function persistOpportunity(input: {
  runId: string;
  source: string;
  runAgency: string;
  opportunity: PersistableOpportunityRecord;
}) {
  const persisted = await persistSourceRecord({
    runId: input.runId,
    source: input.source,
    agency: input.runAgency,
    record: input.opportunity,
  });

  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: persisted.sourceRecordPk,
    record: input.opportunity,
    sourceAuthority: "authoritative",
  });
}

async function cleanup(input: {
  source: string;
  runIds: string[];
  agencySlugs: string[];
}) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE source = ${input.source}`;
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
  "feed excludes inactive records and respects Houston versus all-market scope",
  { skip: !canRun },
  async () => {
    const { source, runAgency } = identity("scope");
    const runId = await startIngestionRun({ source, scope: "all", agency: runAgency });
    const agencySlugs = ["city-of-houston", `${runAgency}-outside`];

    try {
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "houston-active",
          agencySlug: "city-of-houston",
          agencyName: "City of Houston",
          title: "Houston active read fixture",
        }),
      });
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "outside-active",
          agencySlug: agencySlugs[1]!,
          agencyName: "Read Outside Agency",
          title: "Outside active read fixture",
        }),
      });
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "houston-inactive",
          agencySlug: "city-of-houston",
          agencyName: "City of Houston",
          title: "Houston inactive read fixture",
        }),
      });

      await closeDb();
      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        await sql`
          UPDATE opportunities
          SET is_active = false, lifecycle_state = 'inactive_unknown'
          WHERE source = ${source} AND source_opportunity_id = 'houston-inactive'
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const all = await getOpportunityFeed({ market: "all", source, pageSize: 10 });
      assert.equal(all.total, 2);
      assert.deepEqual(
        new Set(all.items.map((item) => item.title)),
        new Set(["Houston active read fixture", "Outside active read fixture"]),
      );

      const houston = await getOpportunityFeed({ market: "houston", source, pageSize: 10 });
      assert.equal(houston.total, 1);
      assert.equal(houston.items[0]?.title, "Houston active read fixture");

      const facets = await getOpportunityFeedFacets("houston");
      assert.ok(facets.agencies.includes("City of Houston"));
      assert.ok(!facets.agencies.includes("Read Outside Agency"));
    } finally {
      await cleanup({ source, runIds: [runId], agencySlugs });
    }
  },
);

test(
  "feed search covers title, solicitation, agency, description, departments, categories, and classifications",
  { skip: !canRun },
  async () => {
    const { source, runAgency } = identity("search");
    const runId = await startIngestionRun({ source, scope: "all", agency: runAgency });
    const agencySlug = `${runAgency}-agency`;

    try {
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "searchable",
          agencySlug,
          agencyName: "Bayou Infrastructure Department",
          title: "Centrifugal Pump Rehabilitation",
          solicitationNumber: "HOU-PUMP-2026-77",
          description: "Replace impellers and restore wet-well pumping capacity.",
          departments: ["Wastewater Operations"],
          categories: ["Rotating Equipment"],
          classifications: [
            {
              sourceClassificationKey: "nigp:720-64",
              scheme: "NIGP",
              code: "720-64",
              name: "Sewage and Sludge Pumps",
              sourceMetadata: {},
            },
          ],
        }),
      });

      for (const query of [
        "Centrifugal",
        "HOU-PUMP-2026-77",
        "Bayou Infrastructure",
        "impellers",
        "Wastewater Operations",
        "Rotating Equipment",
        "720-64",
        "Sludge Pumps",
      ]) {
        const result = await getOpportunityFeed({ market: "all", source, query, pageSize: 10 });
        assert.equal(result.total, 1, `expected search query ${query} to match`);
        assert.equal(result.items[0]?.title, "Centrifugal Pump Rehabilitation");
      }
    } finally {
      await cleanup({ source, runIds: [runId], agencySlugs: [agencySlug] });
    }
  },
);

test(
  "feed pagination clamps invalid values and sorts deterministically",
  { skip: !canRun },
  async () => {
    const { source, runAgency } = identity("pagination");
    const runId = await startIngestionRun({ source, scope: "all", agency: runAgency });
    const agencySlug = `${runAgency}-agency`;

    try {
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "later",
          agencySlug,
          agencyName: "Read Pagination Agency",
          title: "Later deadline",
          publishedAt: new Date("2026-09-03T12:00:00Z"),
          dueAt: new Date("2026-09-20T12:00:00Z"),
        }),
      });
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "earlier",
          agencySlug,
          agencyName: "Read Pagination Agency",
          title: "Earlier deadline",
          publishedAt: new Date("2026-09-01T12:00:00Z"),
          dueAt: new Date("2026-09-10T12:00:00Z"),
        }),
      });
      await persistOpportunity({
        runId,
        source,
        runAgency,
        opportunity: record({
          sourceRecordId: "middle",
          agencySlug,
          agencyName: "Read Pagination Agency",
          title: "Middle deadline",
          publishedAt: new Date("2026-09-02T12:00:00Z"),
          dueAt: new Date("2026-09-15T12:00:00Z"),
        }),
      });

      const invalid = await getOpportunityFeed({
        market: "all",
        source,
        page: Number.NaN,
        pageSize: Number.POSITIVE_INFINITY,
      });
      assert.equal(invalid.page, 1);
      assert.equal(invalid.pageSize, 12);
      assert.deepEqual(
        invalid.items.map((item) => item.title),
        ["Earlier deadline", "Middle deadline", "Later deadline"],
      );

      const clamped = await getOpportunityFeed({
        market: "all",
        source,
        page: 99,
        pageSize: 2,
      });
      assert.equal(clamped.page, 2);
      assert.equal(clamped.pageSize, 2);
      assert.equal(clamped.pageCount, 2);
      assert.deepEqual(clamped.items.map((item) => item.title), ["Later deadline"]);

      const newest = await getOpportunityFeed({
        market: "all",
        source,
        sort: "newest",
        pageSize: 10,
      });
      assert.deepEqual(
        newest.items.map((item) => item.title),
        ["Later deadline", "Middle deadline", "Earlier deadline"],
      );
    } finally {
      await cleanup({ source, runIds: [runId], agencySlugs: [agencySlug] });
    }
  },
);
