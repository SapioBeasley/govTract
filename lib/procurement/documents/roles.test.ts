import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCY_BASELINE_MIN_OPPORTUNITIES,
  classifyRepeatedDocumentRole,
  isAgencyBaselineRequirement,
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
