import assert from "node:assert/strict";
import test from "node:test";

import { deriveSolicitationRequirements } from "./derive";
import type { SolicitationUnderstandingContent } from "../understanding/types";

const base: SolicitationUnderstandingContent = {
  summary: "Fixture",
  scope: [],
  deliverables: [],
  workBreakdown: [],
  location: [],
  schedule: [],
  quantities: [],
  qualifications: [],
  insuranceBonding: [],
  mandatoryEvents: [],
  pricingInstructions: [],
  submissionComponents: [],
  evaluationCriteria: [],
  disqualifiers: [],
  questionsAmbiguities: [],
};

test("derives typed requirement rows without inventing mandatory state", () => {
  const requirements = deriveSolicitationRequirements({
    ...base,
    schedule: [
      { key: "schedule.deadline", text: "Bids must be submitted by 2:00 PM." },
      { key: "schedule.performance", text: "Performance is expected during the winter." },
    ],
    qualifications: [
      { key: "qualification.license", text: "The contractor must hold the required roofing license." },
      { key: "qualification.cert", text: "Provide the required manufacturer certification." },
      { key: "qualification.experience", text: "Relevant roofing experience is evaluated." },
    ],
    insuranceBonding: [
      { key: "insurance.general", text: "Maintain required general liability insurance." },
      { key: "bond.bid", text: "Provide the required bid bond." },
    ],
    mandatoryEvents: [
      { key: "event.prebid", text: "Attendance at the pre-bid meeting is mandatory." },
    ],
    pricingInstructions: [
      { key: "pricing.bid", text: "Price the work on the required pricing schedule." },
    ],
    submissionComponents: [
      { key: "submission.form", text: "Submit the completed bid form." },
      {
        key: "submission.optional",
        text: "An alternate product data sheet is optional.",
        details: { required: false },
      },
    ],
    disqualifiers: [{ key: "late", text: "Late bids will be rejected." }],
  });

  const byFinding = new Map(requirements.map((requirement) => [requirement.sourceFindingKey, requirement]));
  assert.equal(byFinding.get("schedule.deadline")?.type, "deadline");
  assert.equal(byFinding.get("schedule.deadline")?.level, "required");
  assert.equal(byFinding.get("schedule.performance")?.type, "schedule");
  assert.equal(byFinding.get("schedule.performance")?.level, "unknown");
  assert.equal(byFinding.get("qualification.license")?.type, "license");
  assert.equal(byFinding.get("qualification.cert")?.type, "certification");
  assert.equal(byFinding.get("qualification.experience")?.type, "qualification");
  assert.equal(byFinding.get("insurance.general")?.type, "insurance");
  assert.equal(byFinding.get("bond.bid")?.type, "bonding");
  assert.equal(byFinding.get("event.prebid")?.type, "mandatory_event");
  assert.equal(byFinding.get("pricing.bid")?.type, "pricing");
  assert.equal(byFinding.get("submission.form")?.type, "form");
  assert.equal(byFinding.get("submission.optional")?.level, "optional");
  assert.equal(byFinding.get("late")?.type, "disqualifier");
  assert.equal(byFinding.get("late")?.level, "required");
});

test("questions and ambiguities are not promoted into requirements", () => {
  const requirements = deriveSolicitationRequirements({
    ...base,
    questionsAmbiguities: [{ key: "question.one", text: "Confirm whether weekend work is allowed." }],
  });
  assert.deepEqual(requirements, []);
});
