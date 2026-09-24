import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("simplified requirement cards still expose buyer ask, source blockers, saved-response review and server Complete guard", () => {
  const ui = read("components/compliance-matrix-control.tsx");
  // #197 replaces the old three-control status/section/checkbox form with one
  // explicit review action. The previous structural assertions would reject
  // that intentional UX change, so verify the same safety behavior instead.
  assert.match(ui, /What the buyer wants/);
  assert.match(ui, /What you need to do next/);
  assert.match(ui, /nextRequirementAction/);
  assert.match(ui, /BidSourceReviewAction/);
  assert.match(ui, /Review saved response/);
  assert.match(ui, /Mark addressed in my bid/);
  assert.match(ui, /responseSelection:/);
  assert.match(ui, /responseReviewed: true/);
  assert.match(ui, /saveStatus\("complete", true\)/);
  assert.match(ui, /Original source and other options/);
  assert.match(ui, /explainComplianceRequirement/);
  assert.match(ui, /aria-pressed=\{filter === value\}/);
  assert.match(ui, /guidance\.link\.href/);
  assert.doesNotMatch(ui, /generateSolicitationUnderstanding|generateBidSectionDraft/);
  const route = read("app/api/bids/[id]/compliance/[requirementId]/route.ts");
  const persistence = read("lib/bids/compliance-persistence.ts");
  assert.match(route, /updateBidComplianceRequirement/);
  assert.match(persistence, /resolveComplianceStatus/);
  assert.match(persistence, /input\.status === "complete"/);
  assert.match(persistence, /buildBidResponseEvidence/);
  assert.match(route, /body\.responseReviewed !== true/);
});

test("bid page supplies server-derived currentness and prevents a false Complete offer for stale originals", () => {
  const page = read("app/bids/[id]/page.tsx");
  assert.match(page, /snapshotCurrent: Boolean\(/);
  assert.match(page, /understandingCurrent: Boolean\(/);
  assert.match(page, /currentSnapshotId: snapshot\.pursuitSnapshotId/);
  assert.match(page, /currentUnderstandingId: workspace\.sourceRequirements\?\.understandingId/);
});
