import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLICITATION_UNDERSTANDING_SCHEMA_VERSION,
  isSolicitationUnderstandingContent,
  solicitationUnderstandingSectionKeys,
} from "./types";

const validContent = {
  summary: "Replace the existing pump equipment.",
  scope: [{ key: "scope.0", text: "Replace pump equipment." }],
  deliverables: [{ key: "deliverables.0", text: "Commissioned replacement pumps." }],
  workBreakdown: [{ key: "workBreakdown.0", text: "Demolish, install, test, commission." }],
  location: [{ key: "location.0", text: "Houston, Texas." }],
  schedule: [{ key: "schedule.0", text: "Complete within the contract duration." }],
  quantities: [{ key: "quantities.0", text: "Two pump assemblies." }],
  qualifications: [{ key: "qualifications.0", text: "Meet contractor qualification requirements." }],
  insuranceBonding: [{ key: "insuranceBonding.0", text: "Provide required insurance and bonding." }],
  mandatoryEvents: [{ key: "mandatoryEvents.0", text: "Attend the mandatory pre-bid meeting." }],
  pricingInstructions: [{ key: "pricingInstructions.0", text: "Use the agency pricing form." }],
  submissionComponents: [{ key: "submissionComponents.0", text: "Submit pricing and certifications." }],
  evaluationCriteria: [{ key: "evaluationCriteria.0", text: "Price and responsibility are evaluated." }],
  disqualifiers: [{ key: "disqualifiers.0", text: "Late submissions are rejected." }],
  questionsAmbiguities: [{ key: "questionsAmbiguities.0", text: "Confirm shutdown sequencing." }],
};

test("defines the complete machine-readable solicitation understanding section contract", () => {
  assert.equal(SOLICITATION_UNDERSTANDING_SCHEMA_VERSION, "1");
  assert.deepEqual(solicitationUnderstandingSectionKeys, [
    "summary",
    "scope",
    "deliverables",
    "workBreakdown",
    "location",
    "schedule",
    "quantities",
    "qualifications",
    "insuranceBonding",
    "mandatoryEvents",
    "pricingInstructions",
    "submissionComponents",
    "evaluationCriteria",
    "disqualifiers",
    "questionsAmbiguities",
  ]);
  assert.equal(isSolicitationUnderstandingContent(validContent), true);
});

test("rejects incomplete or unstable finding shapes", () => {
  const missingSection = { ...validContent } as Record<string, unknown>;
  delete missingSection.evaluationCriteria;
  assert.equal(isSolicitationUnderstandingContent(missingSection), false);

  assert.equal(
    isSolicitationUnderstandingContent({
      ...validContent,
      scope: [{ key: "", text: "Missing a stable finding key." }],
    }),
    false,
  );

  assert.equal(
    isSolicitationUnderstandingContent({
      ...validContent,
      scope: [{ key: "scope.0", text: "", details: [] }],
    }),
    false,
  );
});
