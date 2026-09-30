import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("package manifest download is available before human approval and reports review state", () => {
  const review = read("components/bid-final-review.tsx");
  const route = read("app/api/bids/[id]/package/route.ts");

  assert.match(review, /Download package manifest/);
  assert.doesNotMatch(review, /pointer-events-none opacity-50/);
  assert.doesNotMatch(review, /aria-disabled={!approvalCurrent \|\| !review\.readyForHumanReview}/);

  assert.doesNotMatch(route, /Resolve package blockers and approve the exact current bid before download/);
  assert.match(route, /Human approval current:/);
  assert.match(route, /Package blockers remaining:/);
  assert.match(route, /Outstanding package blockers:/);
  assert.match(route, /Generate and save the full bid before packaging/);
});
