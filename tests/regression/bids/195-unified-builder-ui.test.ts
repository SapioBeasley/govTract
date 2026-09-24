import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid preparation has one builder with embedded linked checks and an explicit history", () => {
  const page = read("app/bids/[id]/page.tsx");
  const outline = read("components/bid-outline-control.tsx");
  assert.match(page, /id="prepare-bid"/);
  assert.match(page, /groupBidBuilderRequirements/);
  assert.match(page, /previous-source-requirements/);
  assert.match(outline, /<ComplianceRow/);
  assert.match(outline, /Submission & source checks/);
  assert.match(outline, /Suggested heading—edit to match the solicitation/);
  assert.doesNotMatch(page, /title="Compliance requirements"/);
  assert.doesNotMatch(page, /title="Response sections"/);
  assert.match(page, /id="compliance-requirements"/);
  assert.match(page, /id="response-sections"/);
});

test("source evidence viewing is never described as an automatic requiredness fix", () => {
  const guidance = read("lib/bids/compliance-guidance.ts");
  assert.match(guidance, /read-only/i);
  assert.match(guidance, /does not resolve/i);
  const row = read("components/compliance-matrix-control.tsx");
  assert.match(row, /Bid response:/);
  assert.match(row, /Source verification:/);
});
