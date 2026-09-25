import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("reused agency documents are classified by exact source identity and checksum without an AI regeneration", () => {
  const requirements = read("lib/procurement/requirements/persistence.ts");
  const roles = read("lib/procurement/documents/roles.ts");
  assert.match(requirements, /sourceDocumentRole: "agency_baseline"/);
  assert.match(requirements, /sourceDocumentKey/);
  assert.match(requirements, /checksumSha256/);
  assert.match(roles, /AGENCY_BASELINE_MIN_OPPORTUNITIES = 3/);
  assert.doesNotMatch(roles, /Informal General Terms/i, "classification must not be a filename-specific hack");
});

test("agency baseline requirements stay out of response outline and manual AI packets", () => {
  const outline = read("lib/bids/outline.ts");
  const draft = read("lib/bids/draft-input.ts");
  const builder = read("lib/bids/builder.ts");
  assert.match(outline, /isAgencyBaselineRequirement/);
  assert.match(draft, /isAgencyBaselineRequirement/);
  assert.match(builder, /baselineOnlySectionIds/);
  assert.match(builder, /baseline:/);
});

test("bid UI reviews standard agency terms once while preserving forms and saved historical text", () => {
  const ui = read("components/bid-outline-control.tsx");
  const workspace = read("lib/bids/workspace.ts");
  const finalReview = read("lib/bids/final-review.ts");
  assert.match(ui, /Standard agency terms/);
  assert.match(ui, /I reviewed these standard agency terms/);
  assert.match(ui, /older response section/);
  assert.match(workspace, /agencyBaselineReviewFingerprint/);
  assert.match(finalReview, /agency_baseline_terms_unreviewed/);
  assert.match(finalReview, /original_form_unconfirmed/);
});
