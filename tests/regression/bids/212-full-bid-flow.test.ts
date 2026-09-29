import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace exposes one full-bid generation and editor flow", () => {
  const page = read("app/bids/[id]/page.tsx");
  const editor = read("components/full-bid-editor.tsx");
  const route = read("app/api/bids/[id]/draft/route.ts");

  assert.match(page, /FullBidEditor/);
  assert.doesNotMatch(page, /BidOutlineControl|GuidedBidProgress|BidSourceReconciliationAction/);
  assert.match(editor, /Generate bid/);
  assert.match(editor, /Needs your input/);
  assert.match(editor, /Supporting documents/);
  assert.match(route, /generateFullBidDraft/);
});

test("full-bid orchestration preserves manual AI cost guards and migrates saved section content", () => {
  const service = read("lib/bids/full-bid-persistence.ts");
  assert.match(service, /generateBidSectionDraft/);
  assert.match(service, /migratedFromSectionIds/);
  assert.match(service, /sourceRequirementKeys/);
  assert.doesNotMatch(service, /provider\.generate|Gemini/);
});

test("package readiness is based on the saved full draft, supporting items, and exact approval", () => {
  const review = read("lib/bids/final-review.ts");
  const packageRoute = read("app/api/bids/[id]/package/route.ts");
  assert.match(review, /supporting_item_unconfirmed/);
  assert.match(review, /section_placeholder/);
  assert.doesNotMatch(review, /mandatory_requirement_incomplete|agency_baseline_terms_unreviewed/);
  assert.match(packageRoute, /finalReviewApprovalCurrent/);
  assert.match(packageRoute, /application\/zip/);
  assert.match(packageRoute, /buildBidPackage/);
});

test("legacy verification and per-section drafting are no longer reachable from the bid page", () => {
  const page = read("app/bids/[id]/page.tsx");
  assert.doesNotMatch(page, /compliance-requirements|response-sections|previous-source-requirements/);
  assert.doesNotMatch(page, /BidOutlineControl|GuidedBidProgress|BidSourceReconciliationAction/);
});
