import assert from "node:assert/strict";
import test from "node:test";
import { nextRequirementAction } from "./builder-actions";

const base = {
  canMarkComplete: false, effectiveStatus: "needs_review",
  requirementType: "deliverable", status: "drafting",
};
const context = { snapshotCurrent: true, understandingCurrent: true, sourceReady: true,
  matchingResponseReady: true, originalFormConfirmed: false };

test("one actionable step at a time: source first, then response, then explicit confirmation", () => {
  assert.deepEqual(nextRequirementAction(base, context), {
    kind: "source", title: "1. Verify the buyer's requirement",
    detail: "Confirm what the current original asks before marking your response addressed.",
  });
  assert.equal(nextRequirementAction({ ...base, canMarkComplete: true },
    { ...context, matchingResponseReady: false }).kind, "response");
  assert.equal(nextRequirementAction({ ...base, canMarkComplete: true }, context).kind, "confirm");
  assert.equal(nextRequirementAction({ ...base, canMarkComplete: true, effectiveStatus: "complete" }, context).kind, "done");
});
test("a stale source cannot show a completed or confirmable requirement", () => {
  assert.equal(nextRequirementAction({ ...base, canMarkComplete: true, effectiveStatus: "complete" },
    { ...context, snapshotCurrent: false }).kind, "source");
});
test("a required original form uses its own confirmation instead of a prose response", () => {
  assert.equal(nextRequirementAction({ ...base, requirementType: "form", canMarkComplete: true }, context).kind, "form");
  assert.equal(nextRequirementAction({ ...base, requirementType: "form", canMarkComplete: true },
    { ...context, originalFormConfirmed: true }).kind, "confirm");
});
test("an unchanged saved Complete with invalidated response proof explicitly needs another review", () => {
  assert.equal(nextRequirementAction({ ...base, canMarkComplete: true, status: "complete", effectiveStatus: "needs_review" },
    context).kind, "confirm");
});
