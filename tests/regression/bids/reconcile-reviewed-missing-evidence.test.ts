import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("missing source evidence blocks generation directly instead of sending the user through reconciliation", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");

  assert.match(page, /missingEvidence\.length/);
  assert.match(page, /sourceBlockers/);
  assert.match(page, /Restore authoritative document or listing provenance/);
  assert.doesNotMatch(page, /<BidSourceReconciliationAction/);
  assert.match(control, /!sourceReady/);
  assert.match(control, /sourceBlockers\[0\]/);
});

test("internal reconciliation logic may remain only as a non-user-facing provenance safeguard", () => {
  const reconcile = read("lib/bids/source-reconciliation.ts");
  assert.match(reconcile, /requirement_evidence_missing/);
  assert.doesNotMatch(reconcile, /generateSolicitationUnderstanding|generateBidSectionDraft|Gemini/);
});
