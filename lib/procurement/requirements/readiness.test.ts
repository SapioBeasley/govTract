import assert from "node:assert/strict";
import test from "node:test";

import { isSolicitationRequirementSetDraftable } from "./readiness";

const set = (overrides: Partial<{
  completenessStatus: "complete" | "partial";
  incompleteReasons: string[];
  isStale: boolean;
}> = {}) => ({
  completenessStatus: "complete" as const,
  incompleteReasons: [] as string[],
  isStale: false,
  ...overrides,
});

test("complete current requirements are draftable", () => {
  assert.equal(isSolicitationRequirementSetDraftable(set()), true);
});

test("evidence-only partial requirements are draftable because selected requirements are verified later", () => {
  assert.equal(isSolicitationRequirementSetDraftable(set({
    completenessStatus: "partial",
    incompleteReasons: ["requirement_evidence_missing"],
  })), true);
});

test("substantive partial or stale requirements remain blocked", () => {
  assert.equal(isSolicitationRequirementSetDraftable(set({
    completenessStatus: "partial",
    incompleteReasons: ["chunk_failure"],
  })), false);
  assert.equal(isSolicitationRequirementSetDraftable(set({
    completenessStatus: "partial",
    incompleteReasons: ["requirement_evidence_missing", "extraction_partial"],
  })), false);
  assert.equal(isSolicitationRequirementSetDraftable(set({ isStale: true })), false);
  assert.equal(isSolicitationRequirementSetDraftable(null), false);
});
