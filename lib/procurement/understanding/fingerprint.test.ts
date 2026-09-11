import assert from "node:assert/strict";
import test from "node:test";

import { planUnderstandingInputs, type UnderstandingDocumentInput } from "./planning";

const documents: UnderstandingDocumentInput[] = [
  {
    documentVersionId: "doc-v1",
    extractionId: "extraction-1",
    checksumSha256: "checksum-1",
    extractorName: "extractor",
    extractorVersion: "1",
    extractionStatus: "extracted",
    truncated: false,
    segments: [
      {
        id: "segment-1",
        ordinal: 0,
        content: "fixture content",
        contentHashSha256: "segment-hash",
      },
    ],
  },
];

const baseConfig = {
  perDocumentCharBudget: 100,
  perOpportunityCharBudget: 100,
  maxChunkChars: 50,
  promptVersion: "prompt-v1",
  modelProvider: "fixture",
  modelName: "model-a",
  modelVersion: "1",
};

test("overall and chunk fingerprints change with prompt or model compatibility inputs", () => {
  const base = planUnderstandingInputs({ documents, config: baseConfig });
  const promptChanged = planUnderstandingInputs({
    documents,
    config: { ...baseConfig, promptVersion: "prompt-v2" },
  });
  const modelChanged = planUnderstandingInputs({
    documents,
    config: { ...baseConfig, modelVersion: "2" },
  });

  assert.notEqual(base.inputFingerprint, promptChanged.inputFingerprint);
  assert.notEqual(base.inputFingerprint, modelChanged.inputFingerprint);
  assert.notEqual(base.chunks[0]?.inputFingerprint, promptChanged.chunks[0]?.inputFingerprint);
  assert.notEqual(base.chunks[0]?.inputFingerprint, modelChanged.chunks[0]?.inputFingerprint);
});
