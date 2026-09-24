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
