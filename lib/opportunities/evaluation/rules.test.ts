import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_RULE_VERSION,
  evaluateOpportunityInputs,
  type OpportunityEvaluationInput,
} from "@/lib/opportunities/evaluation/rules";

function input(overrides: Partial<OpportunityEvaluationInput> = {}): OpportunityEvaluationInput {
  return {
    now: new Date("2026-09-18T12:00:00Z"),
    profile: {
      productsServices: ["Pump maintenance"],
      capabilities: ["Preventive maintenance", "Field inspection"],
      preferredIndustries: ["Water utilities"],
      preferredKeywords: ["pump", "maintenance"],
      excludedKeywords: ["medical"],
      serviceAreas: ["Houston", "Harris County", "Texas"],
      preferredContractMin: 25_000,
      preferredContractMax: 750_000,
      naicsCodes: ["811310"],
      certifications: [],
      statuses: [],
      licenses: [],
      governmentRegistrations: ["SAM.gov active"],
      pastPerformance: ["Maintained municipal pumping equipment."],
    },
    opportunity: {
      dueAt: new Date("2026-10-15T22:00:00Z"),
      location: { locality: "Houston", region: "TX", country: "US" },
      classifications: [
        { scheme: "NAICS", code: "811310", name: "Commercial machinery repair" },
      ],
    },
    requirements: {
      understandingId: "11111111-1111-4111-8111-111111111111",
      completenessStatus: "complete",
      incompleteReasons: [],
      isStale: false,
      requirements: [
        {
          id: "scope-1",
          requirementKey: "scope:pumps",
          type: "scope",
          level: "required",
          text: "Provide preventive pump maintenance services.",
          sourceSection: "scope",
          sourceFindingKey: "scope.pumps",
          details: {},
          evidence: [
            {
              opportunityDocumentVersionId: "22222222-2222-4222-8222-222222222222",
              documentExtractionSegmentId: "33333333-3333-4333-8333-333333333333",
              locator: { page: 4 },
              excerpt: "Contractor shall provide preventive pump maintenance services.",
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

test("expired deadline is a known mandatory blocker and produces no-go", () => {
  const result = evaluateOpportunityInputs(
    input({
      opportunity: {
        dueAt: new Date("2026-09-17T22:00:00Z"),
        location: { locality: "Houston", region: "TX" },
        classifications: [],
      },
    }),
  );

  assert.equal(result.ruleVersion, EVALUATION_RULE_VERSION);
  assert.equal(result.assessment, "no_go");
  assert.ok(result.factors.some((factor) => factor.kind === "deadline" && factor.status === "blocker"));
});

test("strong deterministic fit can produce go while optional unknown data remains unknown", () => {
  const base = input();
  const result = evaluateOpportunityInputs({
    ...base,
    requirements: {
      ...base.requirements!,
      requirements: [
        ...base.requirements!.requirements,
        {
          id: "optional-1",
          requirementKey: "qualification:optional",
          type: "qualification",
          level: "optional",
          text: "Experience with telemetry systems is preferred.",
          sourceSection: "qualifications",
          sourceFindingKey: "qualification.optional",
          details: {},
          evidence: [],
        },
      ],
    },
  });

  assert.equal(result.assessment, "go");
  assert.ok(result.factors.some((factor) => factor.kind === "scope_fit" && factor.status === "pass"));
  assert.ok(result.factors.some((factor) => factor.status === "unknown" && factor.requirementLevel === "optional"));
});

test("missing evidence for a mandatory qualification stays unknown and makes assessment conditional", () => {
  const base = input();
  const result = evaluateOpportunityInputs({
    ...base,
    requirements: {
      ...base.requirements!,
      requirements: [
        ...base.requirements!.requirements,
        {
          id: "cert-1",
          requirementKey: "qualifications:sbe",
          type: "certification",
          level: "required",
          text: "Bidder must hold the required SBE certification.",
          sourceSection: "qualifications",
          sourceFindingKey: "qualification.sbe",
          details: {},
          evidence: [
            {
              opportunityDocumentVersionId: "44444444-4444-4444-8444-444444444444",
              documentExtractionSegmentId: null,
              locator: { page: 8 },
              excerpt: "Bidder must hold the required SBE certification.",
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.assessment, "conditional");
  const certification = result.factors.find((factor) => factor.requirementKey === "qualifications:sbe");
  assert.equal(certification?.status, "unknown");
  assert.match(certification?.summary ?? "", /not confirmed/i);
  assert.deepEqual(certification?.evidence[0]?.locator, { page: 8 });
});

test("same inputs produce the same deterministic fingerprint", () => {
  const first = evaluateOpportunityInputs(input());
  const second = evaluateOpportunityInputs(input());
  assert.equal(first.inputFingerprint, second.inputFingerprint);
});


test("fingerprint is stable within the same deadline state and changes after expiration", () => {
  const before = input({ now: new Date("2026-09-18T12:00:00Z") });
  const laterBefore = input({ now: new Date("2026-09-20T12:00:00Z") });
  const after = input({ now: new Date("2026-10-16T12:00:00Z") });

  const first = evaluateOpportunityInputs(before);
  const second = evaluateOpportunityInputs(laterBefore);
  const expired = evaluateOpportunityInputs(after);

  assert.equal(first.inputFingerprint, second.inputFingerprint);
  assert.notEqual(first.inputFingerprint, expired.inputFingerprint);
  assert.equal(expired.assessment, "no_go");
});
