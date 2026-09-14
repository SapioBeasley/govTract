import assert from "node:assert/strict";
import test from "node:test";

import { buildUnderstandingEvidenceReferences } from "./evidence";
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

test("packed chunk findings use model-returned source segment ids for exact evidence", () => {
  const finding = {
    key: "qualification.references",
    text: "Provide three similar prime-vendor references.",
    details: { sourceSegmentIds: ["segment-page-5", "segment-page-6"] },
  };
  const content: SolicitationUnderstandingContent = {
    ...base,
    qualifications: [finding],
  };

  const references = buildUnderstandingEvidenceReferences({
    content,
    chunks: [
      {
        documentVersionId: "document-version-1",
        chunkKey: "document-version-1:pack:0",
        structuredOutput: content,
      },
    ],
  });

  assert.deepEqual(references, [
    {
      findingKey: "qualification.references",
      opportunityDocumentVersionId: "document-version-1",
      documentExtractionSegmentId: "segment-page-5",
    },
    {
      findingKey: "qualification.references",
      opportunityDocumentVersionId: "document-version-1",
      documentExtractionSegmentId: "segment-page-6",
    },
  ]);
});

test("legacy single-segment chunks still derive evidence from their chunk key", () => {
  const content: SolicitationUnderstandingContent = {
    ...base,
    scope: [{ key: "scope.one", text: "Replace the roof." }],
  };

  const references = buildUnderstandingEvidenceReferences({
    content,
    chunks: [
      {
        documentVersionId: "document-version-1",
        chunkKey: "document-version-1:legacy-segment-id:0",
        structuredOutput: content,
      },
    ],
  });

  assert.deepEqual(references, [
    {
      findingKey: "scope.one",
      opportunityDocumentVersionId: "document-version-1",
      documentExtractionSegmentId: "legacy-segment-id",
    },
  ]);
});
