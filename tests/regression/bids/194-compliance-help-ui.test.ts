import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("supporting-document readiness replaces requirement-by-requirement Complete controls", () => {
  const editor = read("components/full-bid-editor.tsx");
  const review = read("lib/bids/final-review.ts");
  assert.match(editor, /Supporting documents/);
  assert.match(editor, /prepared or will include with the submission/);
  assert.match(review, /supporting_item_unconfirmed/);
  assert.doesNotMatch(editor, /Mark addressed in my bid|Review saved response|BidSourceReviewAction/);
  assert.doesNotMatch(review, /mandatory_requirement_incomplete/);
});

test("conditional supporting items do not block unless represented as mandatory", () => {
  const fullBid = read("lib/bids/full-bid.ts");
  const review = read("lib/bids/final-review.ts");
  assert.match(fullBid, /mandatory: requirement\.level === "required"/);
  assert.match(fullBid, /conditional = requirement\.level === "conditional"/);
  assert.match(review, /if \(item\.mandatory && !current\)/);
});
