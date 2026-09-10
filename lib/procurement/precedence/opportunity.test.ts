import assert from "node:assert/strict";
import test from "node:test";

import {
  OPPORTUNITY_FIELD_PRECEDENCE_RULES,
  selectCanonicalOpportunityFields,
  type CanonicalOpportunitySourceSnapshot,
} from "./opportunity";

function snapshot(
  source: string,
  authority: CanonicalOpportunitySourceSnapshot["authority"],
  fields: CanonicalOpportunitySourceSnapshot["fields"],
  options: { sourceRecordId?: string; isPrimary?: boolean } = {},
): CanonicalOpportunitySourceSnapshot {
  return {
    source,
    sourceRecordId: options.sourceRecordId ?? `${source}-record`,
    sourceRecordPk: `${source}-pk`,
    authority,
    isPrimary: options.isPrimary ?? false,
    fields,
  };
}

test("field precedence rules are explicit and inspectable", () => {
  assert.equal(OPPORTUNITY_FIELD_PRECEDENCE_RULES.version, 1);
  assert.equal(OPPORTUNITY_FIELD_PRECEDENCE_RULES.authority.authoritative, 300);
  assert.equal(OPPORTUNITY_FIELD_PRECEDENCE_RULES.authority.aggregator, 100);
  assert.equal(OPPORTUNITY_FIELD_PRECEDENCE_RULES.tieBreaker, "primary_then_source_identity");

  for (const field of [
    "solicitationNumber",
    "title",
    "description",
    "status",
    "sourceStatus",
    "opportunityType",
    "agencyName",
    "agencySlug",
    "departments",
    "categories",
    "publishedAt",
    "issueAt",
    "dueAt",
    "canonicalUrl",
    "location",
  ] as const) {
    assert.equal(OPPORTUNITY_FIELD_PRECEDENCE_RULES.fields[field], "highest_ranked_non_empty");
  }
});

test("authoritative values outrank aggregator copies field-by-field while blank authoritative values fall back", () => {
  const result = selectCanonicalOpportunityFields([
    snapshot(
      "bidnet",
      "aggregator",
      {
        title: "Aggregator title",
        description: "Useful aggregator description",
        status: "open",
        dueAt: "2026-10-20T19:00:00.000Z",
        categories: ["Construction"],
      },
      { isPrimary: true },
    ),
    snapshot("beacon", "authoritative", {
      title: "Official title",
      description: null,
      status: "open",
      dueAt: "2026-10-21T19:00:00.000Z",
      categories: [],
    }),
  ]);

  assert.equal(result.fields.title, "Official title");
  assert.equal(result.fields.description, "Useful aggregator description");
  assert.equal(result.fields.dueAt, "2026-10-21T19:00:00.000Z");
  assert.deepEqual(result.fields.categories, ["Construction"]);
  assert.ok(result.provenance.title);
  assert.ok(result.provenance.description);
  assert.equal(result.provenance.title.source, "beacon");
  assert.equal(result.provenance.description.source, "bidnet");
});

test("a later lower-ranked source value cannot replace an authoritative canonical value", () => {
  const authoritative = snapshot("beacon", "authoritative", {
    title: "Official title",
    dueAt: "2026-10-21T19:00:00.000Z",
  });
  const originalAggregator = snapshot(
    "bidnet",
    "aggregator",
    { title: "Aggregator title", dueAt: "2026-10-20T19:00:00.000Z" },
    { isPrimary: true },
  );
  const laterAggregator = snapshot(
    "bidnet",
    "aggregator",
    { title: "Later aggregator rewrite", dueAt: "2026-10-22T19:00:00.000Z" },
    { isPrimary: true },
  );

  const before = selectCanonicalOpportunityFields([originalAggregator, authoritative]);
  const after = selectCanonicalOpportunityFields([laterAggregator, authoritative]);

  assert.equal(before.fields.title, "Official title");
  assert.equal(after.fields.title, "Official title");
  assert.equal(after.fields.dueAt, "2026-10-21T19:00:00.000Z");
  assert.ok(after.provenance.title);
  assert.equal(after.provenance.title.rule, "authority_then_primary_then_source_identity");
});

test("equal-authority conflicts use the designated primary source before stable source identity", () => {
  const result = selectCanonicalOpportunityFields([
    snapshot("source-z", "authoritative", { title: "Secondary official title" }),
    snapshot(
      "source-a",
      "authoritative",
      { title: "Primary official title" },
      { isPrimary: true },
    ),
  ]);

  assert.equal(result.fields.title, "Primary official title");
  assert.ok(result.provenance.title);
  assert.equal(result.provenance.title.source, "source-a");
  assert.equal(result.provenance.title.conflicts?.length, 1);
});
