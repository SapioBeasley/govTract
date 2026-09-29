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

test("agency baseline boilerplate remains excluded from generated bidder assertions", () => {
  const draft = read("lib/bids/draft-input.ts");
  assert.match(draft, /isAgencyBaselineRequirement/);
});

test("standard agency boilerplate is no longer a separate user-facing completion gate", () => {
  const page = read("app/bids/[id]/page.tsx");
  const review = read("lib/bids/final-review.ts");
  assert.doesNotMatch(page, /Standard agency terms|agencyBaselineReviewed/);
  assert.doesNotMatch(review, /agency_baseline_terms_unreviewed/);
  assert.match(page, /source retention, provenance, amendment detection, and version fingerprints remain internal safeguards/i);
});
