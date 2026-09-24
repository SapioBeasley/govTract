import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("guided actions land on existing original, requirement, section, form, and approval controls", () => {
  const page = read("app/bids/[id]/page.tsx");
  const opportunity = read("app/opportunities/[id]/page.tsx");
  assert.match(page, /GuidedBidProgress workspace/);
  for (const id of ["source-snapshot", "source-requirements", "compliance-requirements", "response-sections", "final-review"]) {
    assert.ok(page.includes('id="' + id + '"'), id);
  }
  assert.match(page, /source-document-/);
  assert.match(read("components/compliance-matrix-control.tsx"), /compliance-requirement-/);
  assert.match(read("components/bid-outline-control.tsx"), /response-section-/);
  assert.match(read("components/bid-final-review.tsx"), /original-form-/);
  assert.match(opportunity, /Continue preparing your bid/);
  assert.match(opportunity, /deriveBidGuidance\(existingWorkspace\)\.nextAction\.href/);
});

test("guide uses persisted evidence only and preserves manual model and human handoff guards", () => {
  const model = read("lib/bids/guided-progress.ts");
  const ui = read("components/guided-bid-progress.tsx");
  const sourceAction = read("components/bid-source-reconciliation-action.tsx");
  const finalReview = read("components/bid-final-review.tsx");
  assert.match(model, /workspace\.finalReview\.blockingIssues/);
  assert.match(model, /workspace\.finalReviewApprovalCurrent/);
  assert.doesNotMatch(model, /generateSolicitationUnderstanding|generateBidSectionDraft|fetch\(|useEffect|writeFile/);
  assert.match(ui, /aria-label="Bid preparation steps"/);
  assert.match(ui, /external procurement portal/i);
  assert.match(sourceAction, /window\.confirm/);
  assert.match(finalReview, /!review\.readyForHumanReview/);
  assert.match(finalReview, /govTract does not submit/);
});
