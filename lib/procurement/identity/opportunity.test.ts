import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveOpportunityIdentity,
  type OpportunityIdentityCandidate,
  type OpportunityIdentityInput,
} from "./opportunity";

const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);

function incoming(
  overrides: Partial<OpportunityIdentityInput> = {},
): OpportunityIdentityInput {
  return {
    source: "sam.gov",
    sourceRecordId: "notice-001",
    agencyKey: "city-of-houston",
    solicitationNumber: "ITB-2026-001",
    title: "Downtown Water Main Rehabilitation",
    issueAt: new Date("2026-09-01T15:00:00Z"),
    dueAt: new Date("2026-10-20T19:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documentFingerprints: [checksumA],
    ...overrides,
  };
}

function candidate(
  opportunityId: string,
  overrides: Partial<OpportunityIdentityCandidate> = {},
): OpportunityIdentityCandidate {
  return {
    opportunityId,
    sourceRecords: [{ source: "beacon", sourceRecordId: `beacon-${opportunityId}` }],
    agencyKey: "city-of-houston",
    solicitationNumber: "ITB 2026 001",
    title: "Downtown Water Main Rehabilitation",
    issueAt: new Date("2026-09-01T14:30:00Z"),
    dueAt: new Date("2026-10-20T19:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documentFingerprints: [checksumA],
    ...overrides,
  };
}

test("exact same-source identity always resolves to the existing canonical opportunity", () => {
  const result = resolveOpportunityIdentity({
    incoming: incoming({ source: "BEACON", sourceRecordId: "ABC-123" }),
    candidates: [
      candidate("opp-exact", {
        sourceRecords: [{ source: "beacon", sourceRecordId: "abc-123" }],
        solicitationNumber: "unrelated",
        title: "Completely different title",
      }),
    ],
  });

  assert.equal(result.kind, "match");
  if (result.kind !== "match") return;
  assert.equal(result.opportunityId, "opp-exact");
  assert.equal(result.method, "same_source_record");
  assert.equal(result.confidence, 100);
});

test("same normalized agency and solicitation number produce a high-confidence cross-source match", () => {
  const result = resolveOpportunityIdentity({
    incoming: incoming({ solicitationNumber: "ITB-2026/001" }),
    candidates: [
      candidate("opp-solicitation", {
        sourceRecords: [{ source: "beacon", sourceRecordId: "beacon-991" }],
        solicitationNumber: "itb 2026 001",
      }),
    ],
  });

  assert.equal(result.kind, "match");
  if (result.kind !== "match") return;
  assert.equal(result.opportunityId, "opp-solicitation");
  assert.equal(result.method, "agency_solicitation");
  assert.ok(result.confidence >= 95);
});

test("strong composite evidence can match across sources without a solicitation number", () => {
  const result = resolveOpportunityIdentity({
    incoming: incoming({
      agencyKey: null,
      solicitationNumber: null,
      title: "Water Main Rehabilitation - Downtown Corridor",
    }),
    candidates: [
      candidate("opp-composite", {
        agencyKey: null,
        solicitationNumber: null,
        title: "Downtown Corridor Water Main Rehabilitation",
      }),
    ],
  });

  assert.equal(result.kind, "match");
  if (result.kind !== "match") return;
  assert.equal(result.opportunityId, "opp-composite");
  assert.equal(result.method, "strong_composite");
  assert.ok(result.evidence.signals.includes("document_fingerprint"));
  assert.ok(result.evidence.signals.includes("title"));
  assert.ok(result.evidence.signals.includes("due_date"));
});

test("two similarly strong fuzzy candidates remain ambiguous instead of being irreversibly merged", () => {
  const shared = {
    solicitationNumber: null,
    issueAt: new Date("2026-09-15T15:00:00Z"),
    dueAt: new Date("2026-11-01T20:00:00Z"),
    location: { locality: "Houston", region: "TX", country: "US" },
    documentFingerprints: [] as string[],
  };
  const result = resolveOpportunityIdentity({
    incoming: incoming({
      ...shared,
      title: "Downtown Storm Sewer Rehabilitation",
    }),
    candidates: [
      candidate("opp-phase-one", {
        ...shared,
        title: "Downtown Storm Sewer Rehabilitation Phase One",
      }),
      candidate("opp-phase-two", {
        ...shared,
        title: "Downtown Storm Sewer Rehabilitation Phase Two",
      }),
    ],
  });

  assert.equal(result.kind, "ambiguous");
  if (result.kind !== "ambiguous") return;
  assert.deepEqual(
    result.candidates.map((value) => value.opportunityId).sort(),
    ["opp-phase-one", "opp-phase-two"],
  );
});

test("clear non-matches produce a new canonical identity", () => {
  const result = resolveOpportunityIdentity({
    incoming: incoming(),
    candidates: [
      candidate("opp-unrelated", {
        agencyKey: "harris-county",
        solicitationNumber: "RFP-9999",
        title: "Office Furniture Supply",
        issueAt: new Date("2026-01-01T00:00:00Z"),
        dueAt: new Date("2026-02-01T00:00:00Z"),
        location: { locality: "Dallas", region: "TX", country: "US" },
        documentFingerprints: [checksumB],
      }),
    ],
  });

  assert.equal(result.kind, "new");
});
