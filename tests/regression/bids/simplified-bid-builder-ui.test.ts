import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid preparation leads with exception-driven inputs, then one editable full-bid draft", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");
  assert.match(page, /id="prepare-bid"/);
  assert.match(page, /<BidPackageControl/);
  assert.match(control, /Generate questions/);
  assert.match(control, /Inferred assumptions/);
  assert.match(control, /Bidder facts & choices/);
  assert.match(control, /Draft bid/);
  assert.match(control, /Review & edit bid/);
  assert.match(control, /Save bid/);
  assert.match(control, /Saved responses remain separate/i);
  assert.doesNotMatch(control, /Update bid with my answers|Mark addressed in my bid|Draft with AI/);
});

test("supporting checkboxes represent submission items rather than buyer-source verification", () => {
  const review = read("components/bid-final-review.tsx");
  assert.match(review, /Supporting documents/);
  assert.match(review, /I have completed this required supporting item[\s\S]*included it/i);
  assert.doesNotMatch(review, /I checked the original buyer instruction|Confirm this original|source verification/i);
  assert.match(read("lib/bids/final-review.ts"), /original_form_unconfirmed/);
});
