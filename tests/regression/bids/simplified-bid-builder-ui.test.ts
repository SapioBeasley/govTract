import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace is centered on one generated editable bid", () => {
  const page = read("app/bids/[id]/page.tsx");
  const editor = read("components/full-bid-editor.tsx");
  assert.match(page, /FullBidEditor/);
  assert.match(editor, /Generate bid/);
  assert.match(editor, /Editable full bid/);
  assert.match(editor, /Editing and saving never calls AI/);
  assert.doesNotMatch(page, /GuidedBidProgress|BidOutlineControl|compliance-requirements|response-sections/);
});

test("supporting checkboxes are bidder-side package items, not buyer-document verification", () => {
  const editor = read("components/full-bid-editor.tsx");
  assert.match(editor, /Supporting documents/);
  assert.match(editor, /bidder-side\s+supporting items/);
  assert.match(editor, /Required/);
  assert.match(editor, /Conditional \/ review applicability/);
  assert.doesNotMatch(editor, /I checked the original buyer instruction|Review a different passage/);
});

test("source safeguards stay internal and source failures expose one recovery path", () => {
  const page = read("app/bids/[id]/page.tsx");
  const fullBid = read("lib/bids/full-bid.ts");
  assert.match(page, /Source package status/);
  assert.match(page, /BidSourceRefreshAction/);
  assert.match(page, /Source retention, provenance, amendment detection, and version fingerprints remain internal safeguards/);
  assert.match(fullBid, /complete solicitation package is not readable/i);
});
