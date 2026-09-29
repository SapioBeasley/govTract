import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("reused agency documents are classified deterministically without AI regeneration", () => {
  const requirements = read("lib/procurement/requirements/persistence.ts");
  const roles = read("lib/procurement/documents/roles.ts");
  assert.match(requirements, /sourceDocumentRole: "agency_baseline"/);
  assert.match(requirements, /sourceDocumentKey/);
  assert.match(requirements, /checksumSha256/);
  assert.match(roles, /AGENCY_BASELINE_MIN_OPPORTUNITIES = 3/);
  assert.doesNotMatch(roles, /Informal General Terms/i);
});

test("full-bid generation excludes agency baseline boilerplate while preserving original-form safeguards", () => {
  const draft = read("lib/bids/draft-persistence.ts");
  const finalReview = read("lib/bids/final-review.ts");
  assert.match(draft, /isAgencyBaselineRequirement/);
  assert.match(draft, /filter\(\(requirement\) => !isAgencyBaselineRequirement\(requirement\)\)/);
  assert.match(finalReview, /original_form_unconfirmed/);
  assert.doesNotMatch(finalReview, /agency_baseline_terms_unreviewed/);
});
