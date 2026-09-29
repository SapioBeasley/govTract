import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("simplified bid page does not expose requirement-by-requirement completion or source-review controls", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");

  assert.match(page, /<BidPackageControl/);
  assert.doesNotMatch(page, /<ComplianceMatrixControl|<BidSourceReconciliationAction|<BidOutlineControl/);
  assert.doesNotMatch(control, /Mark addressed in my bid|I checked the original buyer instruction|responseReviewed/);
});

test("generation readiness is still derived from the current retained source package", () => {
  const page = read("app/bids/[id]/page.tsx");
  assert.match(page, /snapshot\.snapshotStatus === "complete"/);
  assert.match(page, /!snapshot\.stale/);
  assert.match(page, /workspace\.sourceRequirements\?\.completenessStatus === "complete"/);
  assert.match(page, /sourceBlockers=\{sourceBlockers\}/);
});
