import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocumentExtractionIdentity,
  prepareExtractionSegments,
} from "./extractions";

const CHECKSUM = "A".repeat(64);

test("buildDocumentExtractionIdentity normalizes deterministic checksum identity", () => {
  assert.deepEqual(
    buildDocumentExtractionIdentity({
      checksumSha256: ` ${CHECKSUM} `,
      extractorName: " pdf-text ",
      extractorVersion: " 1 ",
    }),
    {
      checksumSha256: CHECKSUM.toLowerCase(),
      extractorName: "pdf-text",
      extractorVersion: "1",
    },
  );
});

test("buildDocumentExtractionIdentity rejects non SHA-256 values", () => {
  assert.throws(
    () =>
      buildDocumentExtractionIdentity({
        checksumSha256: "abc",
        extractorName: "pdf-text",
        extractorVersion: "1",
      }),
    /SHA-256/,
  );
});

test("prepareExtractionSegments keeps provenance while bounding a segment", () => {
  const prepared = prepareExtractionSegments(
    [
      {
        segmentType: "page",
        locator: { page: 1 },
        content: "abcdef",
      },
    ],
    { maxExtractedBytes: 10, maxSegmentBytes: 4, maxSegments: 10 },
  );

  assert.equal(prepared.segments.length, 1);
  assert.equal(prepared.segments[0].content, "abcd");
  assert.deepEqual(prepared.segments[0].locator, { page: 1 });
  assert.equal(prepared.extractedByteCount, 4);
  assert.equal(prepared.truncated, true);
  assert.equal(prepared.truncationReason, "segment_byte_limit");
  assert.match(prepared.segments[0].contentHashSha256, /^[0-9a-f]{64}$/);
});

test("prepareExtractionSegments applies one document-wide byte budget", () => {
  const prepared = prepareExtractionSegments(
    [
      { segmentType: "page", locator: { page: 1 }, content: "12345" },
      { segmentType: "page", locator: { page: 2 }, content: "67890" },
    ],
    { maxExtractedBytes: 7, maxSegmentBytes: 10, maxSegments: 10 },
  );

  assert.deepEqual(
    prepared.segments.map((segment) => segment.content),
    ["12345", "67"],
  );
  assert.equal(prepared.extractedByteCount, 7);
  assert.equal(prepared.truncated, true);
  assert.equal(prepared.truncationReason, "document_byte_limit");
});

test("prepareExtractionSegments preserves UTF-8 boundaries", () => {
  const prepared = prepareExtractionSegments(
    [{ segmentType: "document", content: "A😀B" }],
    { maxExtractedBytes: 5, maxSegmentBytes: 5, maxSegments: 10 },
  );

  assert.equal(prepared.segments[0].content, "A😀");
  assert.equal(Buffer.byteLength(prepared.segments[0].content, "utf8"), 5);
});

test("prepareExtractionSegments caps segment count", () => {
  const prepared = prepareExtractionSegments(
    [
      { segmentType: "sheet", locator: { sheet: "A" }, content: "one" },
      { segmentType: "sheet", locator: { sheet: "B" }, content: "two" },
    ],
    { maxExtractedBytes: 100, maxSegmentBytes: 100, maxSegments: 1 },
  );

  assert.equal(prepared.segments.length, 1);
  assert.equal(prepared.truncationReason, "segment_count_limit");
});

test("prepareExtractionSegments marks partial extractor output as truncated", () => {
  const prepared = prepareExtractionSegments(
    [
      { segmentType: "page", locator: { page: 1 }, content: "one" },
      { segmentType: "page", locator: { page: 3 }, content: "three" },
    ],
    {
      maxExtractedBytes: 100,
      maxSegmentBytes: 100,
      maxSegments: 10,
      partialExtraction: true,
    },
  );

  assert.equal(prepared.truncated, true);
  assert.equal(prepared.truncationReason, "extractor_partial");
  assert.deepEqual(prepared.segments.map((segment) => segment.locator.page), [1, 3]);
});
