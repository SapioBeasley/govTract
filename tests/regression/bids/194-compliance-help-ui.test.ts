import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("compliance cards explain requirement, response, and recovery without weakening the Complete guard", () => {
  const ui = read("components/compliance-matrix-control.tsx");
  assert.match(ui, /How to use this checklist/);
  assert.match(ui, /What the buyer asks/);
  assert.match(ui, /My bid response/);
  assert.match(ui, /Why Complete is disabled/);
  assert.match(ui, /Where my bid addresses it/);
  assert.match(ui, /disabled=\{value === "complete" && !guidance\.canComplete\}/);
  assert.match(ui, /explainComplianceRequirement/);
  assert.match(ui, /aria-pressed=\{filter === value\}/);
  assert.match(ui, /guidance\.link\.href/);
  assert.match(ui, /responseSelection: responseChoice/);
  assert.match(ui, /checked=\{reviewedResponse\}/);
  assert.match(ui, /const needsReproof = requirement\.status === "complete" && requirement\.effectiveStatus !== "complete"/);
  assert.match(ui, /status !== requirement\.status \|\| needsReproof/);
  assert.match(ui, /disabled=\{!changed \|\| pending \|\| \(confirmingComplete/);
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
