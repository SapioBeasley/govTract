import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("one full-bid action replaces response headings and requirement completion controls", () => {
  const page = read("app/bids/[id]/page.tsx");
  const editor = read("components/full-bid-editor.tsx");
  assert.match(page, /FullBidEditor/);
  assert.match(editor, /Generate bid/);
  assert.doesNotMatch(page, /BidOutlineControl|ComplianceMatrixControl|compliance-requirements|response-sections/);
});

test("generation still preserves source provenance and explicit manual cost controls", () => {
  const service = read("lib/bids/full-bid-persistence.ts");
  const legacyGenerator = read("lib/bids/draft-persistence.ts");
  assert.match(service, /generateBidSectionDraft/);
  assert.match(service, /sourceRequirementKeys/);
  assert.match(legacyGenerator, /GOVTRACT_AI_BID_DRAFT_BUDGET_USD/);
  assert.match(legacyGenerator, /requestId/);
});
