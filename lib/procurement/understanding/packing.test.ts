import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UNDERSTANDING_BUDGET_POLICY,
  planUnderstandingInputs,
  type UnderstandingDocumentInput,
} from "./planning";

function segment(id: string, ordinal: number, content: string) {
  return {
    id,
    ordinal,
    content,
    contentHashSha256: `hash-${id}`,
  };
}

function document(segments: UnderstandingDocumentInput["segments"]): UnderstandingDocumentInput {
  return {
    documentVersionId: "doc-v1",
    extractionId: "extraction-1",
    checksumSha256: "checksum-1",
    extractorName: "fixture",
    extractorVersion: "1",
    extractionStatus: "extracted",
    truncated: false,
    segments,
  };
}

const baseConfig = {
  perDocumentCharBudget: 200_000,
  perOpportunityCharBudget: 600_000,
  maxChunkChars: 200_000,
  promptVersion: "understanding-v2",
  modelProvider: "fixture",
  modelName: "fixture-model",
  modelVersion: "1",
};

test("default planning packs up to the full per-document character budget", () => {
  assert.equal(DEFAULT_UNDERSTANDING_BUDGET_POLICY.maxChunkChars, 200_000);
});

test("adjacent extraction segments are whitespace-normalized and packed into one bounded request", () => {
  const plan = planUnderstandingInputs({
    documents: [
      document([
        segment("segment-a", 0, "First   page.\n\n\nRequirement   A shall apply."),
        segment("segment-b", 1, "Second\tpage.\n\nRequirement B shall apply."),
        segment("segment-c", 2, "Third page. Requirement C shall apply."),
      ]),
    ],
    config: baseConfig,
  });

  assert.equal(plan.chunks.length, 1);
  const chunk = plan.chunks[0]!;
  assert.deepEqual(chunk.sourceSegmentIds, ["segment-a", "segment-b", "segment-c"]);
  assert.match(chunk.content, /\[\[SOURCE_SEGMENT:segment-a\]\]/);
  assert.match(chunk.content, /\[\[SOURCE_SEGMENT:segment-b\]\]/);
  assert.match(chunk.content, /\[\[SOURCE_SEGMENT:segment-c\]\]/);
  assert.doesNotMatch(chunk.content, / {2,}/);
  assert.doesNotMatch(chunk.content, /\n{3,}/);
  assert.ok(chunk.charCount <= baseConfig.maxChunkChars);
});

test("packing stays deterministic and splits only when the packed request would cross the limit", () => {
  const config = { ...baseConfig, maxChunkChars: 120 };
  const documents = [
    document([
      segment("segment-a", 0, "A".repeat(45)),
      segment("segment-b", 1, "B".repeat(45)),
      segment("segment-c", 2, "C".repeat(45)),
    ]),
  ];

  const first = planUnderstandingInputs({ documents, config });
  const repeated = planUnderstandingInputs({ documents, config });

  assert.deepEqual(first, repeated);
  assert.equal(first.chunks.length, 2);
  assert.deepEqual(first.chunks.flatMap((chunk) => chunk.sourceSegmentIds), [
    "segment-a",
    "segment-b",
    "segment-c",
  ]);
  assert.ok(first.chunks.every((chunk) => chunk.charCount <= config.maxChunkChars));
});
