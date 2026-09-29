import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("superseded guided multi-step bid progress is not reachable", () => {
  const page = read("app/bids/[id]/page.tsx");
  assert.doesNotMatch(page, /GuidedBidProgress|Current step|Workflow status and diagnostics/);
  assert.match(page, /FullBidEditor/);
  assert.match(page, /Package blockers/);
});

test("human approval stays tied to exact current package state", () => {
  const workspace = read("lib/bids/workspace.ts");
  const review = read("lib/bids/final-review.ts");
  assert.match(workspace, /finalReviewApprovalFingerprint/);
  assert.match(workspace, /finalReview\.reviewFingerprint/);
  assert.match(review, /confirmedSupportingItems/);
  assert.match(review, /fullBid/);
});
