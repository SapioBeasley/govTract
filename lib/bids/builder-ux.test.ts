import assert from "node:assert/strict";
import test from "node:test";
import { deriveBidBuilderProgress, deriveSaveState, saveStateLabel } from "./builder-ux";

test("save state makes dirty, saving, failure, and persisted draft explicit", () => {
  assert.equal(saveStateLabel(deriveSaveState({ changed: true, pending: false })), "Unsaved changes");
  assert.equal(saveStateLabel(deriveSaveState({ changed: true, pending: true })), "Saving…");
  assert.equal(saveStateLabel(deriveSaveState({ changed: false, pending: false })), "Saved draft");
  assert.equal(saveStateLabel(deriveSaveState({ changed: false, pending: false, failed: true })), "Save failed");
});

test("progress excludes history supplied by callers and chooses deterministic next work", () => {
  const base = {
    activeSections: [{ id: "a", content: "saved" }, { id: "b", content: "" }],
    activeRequirements: [{ id: "r1", effectiveStatus: "complete", sourceVerified: true },
      { id: "r2", effectiveStatus: "drafting", sourceVerified: false }],
    baselineExists: true, baselineReviewed: false, sourceReady: true, finalReviewBlockers: 2,
  };
  const progress = deriveBidBuilderProgress(base);
  assert.deepEqual([progress.savedSections, progress.totalSections, progress.addressedRequirements, progress.totalRequirements], [1, 2, 1, 2]);
  assert.equal(progress.unresolvedSourceChecks, 1);
  assert.equal(progress.nextAction.href, "#response-section-b");

  assert.equal(deriveBidBuilderProgress({ ...base, sourceReady: false }).nextAction.href, "#source-documents-and-technical-details");
  assert.equal(deriveBidBuilderProgress({ ...base, activeSections: [{ id: "a", content: "saved" }, { id: "b", content: "saved" }] }).nextAction.href,
    "#compliance-requirement-r2");
});
