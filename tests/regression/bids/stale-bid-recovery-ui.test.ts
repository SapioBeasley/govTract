import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("stale bid source collapses generation into one recovery blocker", () => {
  const page = read("app/bids/[id]/page.tsx");
  const fullBid = read("lib/bids/full-bid.ts");
  assert.match(page, /generationBlockers/);
  assert.match(fullBid, /The solicitation changed\. Refresh the retained source package before generating the bid/);
  assert.match(page, /Source package status/);
  assert.doesNotMatch(page, /BidSourceReconciliationAction|source-reconciliation/);
});

test("source recovery uses original-file retrieval without automatic AI regeneration", () => {
  const page = read("app/bids/[id]/page.tsx");
  const sourceAction = read("components/bid-source-refresh-action.tsx");
  assert.match(page, /BidSourceRefreshAction/);
  assert.match(sourceAction, /independent of paid AI drafting/);
  assert.doesNotMatch(sourceAction, /generateFullBidDraft|generateBidSectionDraft|provider\.generate/);
});
