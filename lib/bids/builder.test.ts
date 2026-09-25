import assert from "node:assert/strict";
import test from "node:test";

import { groupBidBuilderRequirements } from "./builder";
import type { BidWorkspaceRequirement, BidWorkspaceSection } from "./workspace";

const requirement = (understanding: string, index: number, type = "deliverable"): BidWorkspaceRequirement => ({
  id: `${understanding}-row-${index}`,
  sourceRequirementKey: `${understanding}:source-${index}`,
  requirementType: type,
  text: `Buyer requirement ${index}`,
  isRequired: true,
  status: "missing",
  effectiveStatus: "missing",
  canMarkComplete: true,
  evidence: { understandingId: understanding, sourceRequirementId: `source-${index}`,
    sourceFindingKey: `finding-${index}`, pursuitSnapshotId: "snapshot", requirementLevel: "required",
    issues: [], references: [] },
  responseNotes: null,
  sortOrder: index,
});

const section = (id: string, keys: string[]): BidWorkspaceSection => ({
  id, title: id === "technical" ? "Technical response" : "Pricing",
  instructions: null, content: null, status: "draft",
  requirementLinks: { sourceRequirementKeys: keys },
  sortOrder: 0, wordCount: 0,
  metadata: { source: "fallback_group" },
});

test("41 current and 34 historical rows remain separate without losing notes or past progress", () => {
  const current = Array.from({ length: 41 }, (_, i) => requirement("current", i));
  const old = Array.from({ length: 34 }, (_, i) => ({
    ...requirement("previous", i),
    status: "complete", responseNotes: `Prior work ${i}`,
  }));
  const result = groupBidBuilderRequirements([...old, ...current], [], "current");
  assert.equal(result.current.length, 41);
  assert.equal(result.historical.length, 34);
  assert.equal(result.unassigned.length, 41);
  assert.equal(result.historical[0]?.responseNotes, "Prior work 0");
  assert.equal(result.current.some((item) => item.id.startsWith("previous")), false);
});

test("source keys map current rows only to their actual saved heading and keep unmatched checks visible", () => {
  const current = [
    requirement("current", 0),
    requirement("current", 1, "pricing"),
    requirement("current", 2, "submission_instruction"),
    requirement("current", 3, "mandatory_event"),
  ];
  const sections = [
    section("technical", ["current:source-0", "previous:source-9"]),
    section("pricing", ["current:source-1", "current:source-2"]),
  ];
  const result = groupBidBuilderRequirements(
    [...current, requirement("previous", 9)], sections, "current",
  );
  assert.deepEqual(result.bySection.technical?.map((row) => row.id), ["current-row-0"]);
  assert.deepEqual(result.bySection.pricing?.map((row) => row.id), ["current-row-1"]);
  assert.deepEqual(result.unassigned.map((row) => row.id), ["current-row-2", "current-row-3"]);
  assert.equal(result.historical.length, 1);
});

test("a missing current understanding does not quietly treat old rows as active", () => {
  const result = groupBidBuilderRequirements([requirement("previous", 1)], [], null);
  assert.equal(result.current.length, 0);
  assert.equal(result.historical.length, 1);
});

test("prescribed submission response is authorable but a generic submission fallback is not", () => {
  const ask = requirement("current", 8, "submission_instruction");
  const prescribed = { ...section("cover", [ask.sourceRequirementKey!]),
    metadata: { source: "solicitation_heading" } };
  const result = groupBidBuilderRequirements([ask], [prescribed], "current");
  assert.equal(result.bySection.cover?.length, 1);
  assert.equal(result.unassigned.length, 0);
});

test("persisted outline requirementKey maps through source ID to compliance understanding:id key", () => {
  const row = requirement("current", 7);
  const sections = [section("technical", ["deliverables:assembled_unit_delivery"])];
  const source = [{ id: "source-7", requirementKey: "deliverables:assembled_unit_delivery" }];
  const result = groupBidBuilderRequirements([row], sections, "current", source);
  assert.deepEqual(result.bySection.technical?.map((item) => item.id), [row.id]);
  assert.equal(result.unassigned.length, 0);
});


test("agency baseline requirements are separated from response writing and unmatched opportunity checks", () => {
  const baseline = requirement("current", 10, "pricing");
  const specific = requirement("current", 11, "deliverable");
  const sections = [section("technical", ["deliverables:item", "pricing:standard-terms"])];
  const result = groupBidBuilderRequirements(
    [baseline, specific],
    sections,
    "current",
    [
      { id: "source-10", requirementKey: "pricing:standard-terms",
        details: { sourceDocumentRole: "agency_baseline" } },
      { id: "source-11", requirementKey: "deliverables:item", details: {} },
    ],
  );
  assert.deepEqual(result.bySection.technical?.map((row) => row.id), [specific.id]);
  assert.deepEqual(result.baseline.map((row) => row.id), [baseline.id]);
  assert.deepEqual(result.unassigned, []);
});
