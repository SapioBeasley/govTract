import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("stale source blocks the single Generate bid action with one concise recovery reason", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");
  assert.match(page, /sourceBlockers/);
  assert.match(page, /snapshot\.stale/);
  assert.match(control, /disabled=\{!sourceReady \|\| pending \|\| changed\}/);
  assert.match(control, /sourceBlockers\[0\]/);
  assert.doesNotMatch(control, /reconciliation|verification checklist/i);
});

test("unretained source files still expose bounded deterministic retrieval", () => {
  const page = read("app/bids/[id]/page.tsx");
  const refresh = read("components/bid-source-refresh-action.tsx");
  assert.match(page, /<BidSourceRefreshAction/);
  assert.match(refresh, /Retrieve source files/);
  assert.doesNotMatch(refresh, /generateBidSectionDraft|generateSolicitationUnderstanding/);
});
