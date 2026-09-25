import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCY_BASELINE_MIN_OPPORTUNITIES,
  classifyRepeatedDocumentRole,
  isAgencyBaselineRequirement,
  agencyBaselineReviewFingerprint,
} from "./roles";

test("only an exact repeated source document within one agency becomes agency baseline", () => {
  assert.equal(AGENCY_BASELINE_MIN_OPPORTUNITIES, 3);
  assert.equal(classifyRepeatedDocumentRole({
    sourceDocumentKey: "agency/shared/general-terms",
    checksumSha256: "a".repeat(64),
    distinctOpportunityCount: 3,
  }), "agency_baseline");
  assert.equal(classifyRepeatedDocumentRole({
    sourceDocumentKey: "agency/shared/general-terms",
    checksumSha256: "a".repeat(64),
    distinctOpportunityCount: 2,
  }), "opportunity_specific");
  assert.equal(classifyRepeatedDocumentRole({
    sourceDocumentKey: "agency/shared/general-terms",
    checksumSha256: null,
    distinctOpportunityCount: 20,
  }), "opportunity_specific");
});

test("requirements are baseline only when every document citation is from a repeated agency document", () => {
  assert.equal(isAgencyBaselineRequirement({
    details: { sourceDocumentRole: "agency_baseline" },
  }), true);
  assert.equal(isAgencyBaselineRequirement({
    details: { sourceDocumentRole: "opportunity_specific" },
  }), false);
  assert.equal(isAgencyBaselineRequirement({ details: {} }), false);
});


test("standard terms review fingerprint is tied to both the classified terms and current source package", () => {
  const requirement = {
    id: "r1", requirementKey: "pricing:hold", type: "pricing", level: "required",
    text: "Hold pricing for 90 days.",
    evidence: [{ opportunityDocumentVersionId: "v1" }],
    details: { sourceDocumentRole: "agency_baseline" },
  };
  const first = agencyBaselineReviewFingerprint([requirement], "source-a");
  assert.match(first ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(agencyBaselineReviewFingerprint([
    { ...requirement, text: "Hold pricing for 120 days." },
  ], "source-a"), first);
  assert.notEqual(agencyBaselineReviewFingerprint([requirement], "source-b"), first);
  assert.equal(agencyBaselineReviewFingerprint([
    { ...requirement, details: {} },
  ], "source-a"), null);
});
