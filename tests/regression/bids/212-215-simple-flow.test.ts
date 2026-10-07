import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace exposes the exception-driven full-bid flow instead of the superseded guided builder", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");

  assert.match(page, /<BidPackageControl/);
  assert.doesNotMatch(page, /<BidOutlineControl/);
  assert.doesNotMatch(page, /<GuidedBidProgress/);
  assert.doesNotMatch(page, /<BidSourceReconciliationAction/);

  assert.match(control, /Generate questions/);
  assert.match(control, /\/api\/bids\/\$\{workspaceId\}\/questions/);
  assert.match(control, /Bidder facts & choices/);
  assert.match(control, /Inferred assumptions/);
  assert.match(control, /\/api\/bids\/\$\{workspaceId\}\/requirements\/\$\{item\.id\}\/response/);
  assert.match(control, /Draft bid/);
  assert.match(control, /\/api\/bids\/\$\{workspaceId\}\/draft/);
  assert.doesNotMatch(control, /Update bid with my answers|Mark addressed in my bid|Draft with AI/);
});

test("supporting-document checklist tracks submission materials, not source verification", () => {
  const review = read("components/bid-final-review.tsx");

  assert.match(review, /Supporting documents/);
  assert.match(review, /I have completed this required supporting item[\s\S]*included it/i);
  assert.doesNotMatch(review, /I checked the original buyer instruction/);
  assert.doesNotMatch(review, /source verification/i);
});

test("final package has a deterministic manifest/download handoff and exact-version approval", () => {
  const review = read("components/bid-final-review.tsx");
  const route = read("app/api/bids/[id]/package/route.ts");

  assert.match(review, /Package manifest/);
  assert.match(review, /\/api\/bids\/\$\{workspaceId\}\/package/);
  assert.match(review, /Approve current package/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /manifest/i);
  assert.doesNotMatch(route, /createGeminiBidDraftProvider|generateBidSectionDraft|generateFullBidDraft/);
});
