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

test("generation stays grounded in the authoritative inventory while explicit Generate performs recovery", () => {
  const page = read("app/bids/[id]/page.tsx");
  const route = read("app/api/bids/[id]/draft/route.ts");

  assert.match(page, /snapshot\.totalDocumentCount > 0/);
  assert.match(page, /snapshot\.documents\.length === snapshot\.totalDocumentCount/);
  assert.match(page, /sourceBlockers=\{sourceBlockers\}/);
  assert.match(route, /refreshBidSourceSnapshot/);
  assert.match(route, /ensureStoredSnapshotExtractions/);
  assert.match(route, /generateSolicitationUnderstanding/);
  assert.match(route, /explicitManualUserAction:\s*true/);
});
