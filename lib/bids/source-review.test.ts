import assert from "node:assert/strict";
import test from "node:test";

import { applySourceReview, type SourceReviewRecord } from "./source-review";
import type { ComplianceEvidence } from "./compliance";

const original: ComplianceEvidence = {
  understandingId: "understanding-1", sourceRequirementId: "req-1",
  sourceFindingKey: "finding-1", requirementLevel: "unknown", pursuitSnapshotId: "snapshot-1",
  references: [], issues: ["requirement_requiredness_unknown", "requirement_evidence_missing", "requirement_set_incomplete"],
};

const review: SourceReviewRecord = {
  understandingId: "understanding-1", sourceRequirementId: "req-1",
  snapshotId: "snapshot-1", sourceFingerprint: "sha-1",
  level: "required", documentVersionId: "version-1", documentChecksum: "checksum-1",
  snapshotDocumentId: "document-1", segmentId: "segment-1",
  locator: { page: 4 }, excerpt: "The offeror shall provide one fully assembled unit.",
};

test("an explicit source review separately verifies unknown requiredness and missing citation without altering original", () => {
  const saved = JSON.stringify(original);
  const effective = applySourceReview(original, review, {
    understandingId: "understanding-1", snapshotId: "snapshot-1", fingerprint: "sha-1",
    documents: [{ id: "document-1", opportunityDocumentVersionId: "version-1",
      status: "stored", checksumSha256: "checksum-1" }],
  });
  assert.equal(effective.requirementLevel, "required");
  assert.equal(effective.references[0]?.excerpt, review.excerpt);
  assert.deepEqual(effective.issues, []);
  assert.equal(JSON.stringify(original), saved, "immutable AI/source finding must not change");
});

test("source review is ignored when understanding, snapshot, fingerprint, or source checksum changes", () => {
  for (const change of [
    { understandingId: "understanding-2" }, { snapshotId: "snapshot-2" },
    { fingerprint: "sha-2" }, { documents: [{ id: "document-1",
      opportunityDocumentVersionId: "version-1", status: "stored", checksumSha256: "new-checksum" }] },
  ]) {
    const effective = applySourceReview(original, review, {
      understandingId: "understanding-1", snapshotId: "snapshot-1", fingerprint: "sha-1",
      documents: [{ id: "document-1", opportunityDocumentVersionId: "version-1",
        status: "stored", checksumSha256: "checksum-1" }], ...change,
    });
    assert.deepEqual(effective, original);
  }
});

test("a verified reviewer decision does not erase unrelated provenance defects", () => {
  const state = { ...original, issues: [...original.issues, "document_version_outside_snapshot"] };
  const effective = applySourceReview(state, review, {
    understandingId: "understanding-1", snapshotId: "snapshot-1", fingerprint: "sha-1",
    documents: [{ id: "document-1", opportunityDocumentVersionId: "version-1",
      status: "stored", checksumSha256: "checksum-1" }],
  });
  assert.ok(effective.issues.includes("document_version_outside_snapshot"));
});
