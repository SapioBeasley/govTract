import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid builder leads with a write-then-review flow, not source metadata and a giant checklist", () => {
  const page = read("app/bids/[id]/page.tsx");
  const outline = read("components/bid-outline-control.tsx");
  assert.match(outline, /Step 1: Write your response/);
  assert.match(outline, /Step 2: Check what the buyer asked for/);
  assert.match(outline, /<details[^>]*>\s*<summary[^>]*>Edit heading and source instructions/);
  assert.match(page, /id="source-documents-and-technical-details"[\s\S]*?<summary[^>]*>\s*Source documents and technical details/);
  assert.match(page, /<GuidedBidProgress workspace=\{workspace\}/);
  assert.match(page, /id="prepare-bid"/);
});

test("each buyer ask has one primary action and preserves source details in an optional drawer", () => {
  const row = read("components/compliance-matrix-control.tsx");
  assert.match(row, /nextRequirementAction\(/);
  assert.match(row, /What the buyer wants/);
  assert.match(row, /What you need to do next/);
  assert.match(row, /Mark addressed in my bid/);
  assert.match(row, /Review saved response/);
  assert.match(row, /<summary[^>]*>Original source and other options/);
  assert.match(row, /BidSourceReviewAction/);
  assert.match(row, /responseReviewed: true/);
  assert.match(row, /responseSelection:/);
  assert.match(row, /<ComplianceRow/);
});

test("source verification uses an explicitly confirmed current original with a preselected pinned excerpt", () => {
  const review = read("components/bid-source-review-action.tsx");
  const service = read("lib/bids/source-review-persistence.ts");
  assert.match(review, /pinnedReviewChoice/);
  assert.match(review, /Confirm this original/);
  assert.match(review, /I checked the original buyer instruction/);
  assert.match(review, /Review a different passage/);
  assert.match(service, /documentExtractions\.checksumSha256/);
  assert.match(service, /bidRequirementSourceReviews/);
});
