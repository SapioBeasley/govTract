import assert from "node:assert/strict";
import test from "node:test";

import { attachSourceSegmentCitations } from "./citations";
import type { SolicitationUnderstandingContent } from "./types";

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

test("citation prefixes become validated sourceSegmentIds and are stripped from stable keys", () => {
  const result = attachSourceSegmentCitations(
    {
      ...base,
      qualifications: [
        {
          key: "SOURCE[segment-a,segment-b,not-in-chunk]::qualification.references",
          text: "Provide three similar references.",
        },
      ],
    },
    new Set(["segment-a", "segment-b"]),
  );

  assert.deepEqual(result.qualifications[0], {
    key: "qualification.references",
    text: "Provide three similar references.",
    details: { sourceSegmentIds: ["segment-a", "segment-b"] },
  });
});

test("metadata-only keys are normalized without inventing source evidence", () => {
  const result = attachSourceSegmentCitations(
    {
      ...base,
      scope: [{ key: "META::scope.metadata", text: "Metadata-backed scope." }],
    },
    new Set(),
  );
  assert.deepEqual(result.scope[0], {
    key: "scope.metadata",
    text: "Metadata-backed scope.",
    details: { sourceSegmentIds: [] },
  });
});
