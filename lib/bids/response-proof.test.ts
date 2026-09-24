import assert from "node:assert/strict";
import test from "node:test";

import { buildBidResponseEvidence, responseEvidenceIsCurrent } from "./response-proof";

const section = (overrides: Record<string, unknown> = {}) => ({
  id: "section-1", title: "Technical response", content: "We will deliver three devices.",
  metadata: { pursuitSnapshotId: "snapshot-1", documentSetFingerprint: "fingerprint-1",
    understandingId: "understanding-1" },
  ...overrides,
});
const source = { snapshotId: "snapshot-1", fingerprint: "fingerprint-1", understandingId: "understanding-1" };

test("a solicitation citation alone cannot provide bid-response completion evidence", () => {
  assert.equal(responseEvidenceIsCurrent(null, [section()], [], "deliverable", "source-1", source), false);
  assert.throws(() => buildBidResponseEvidence({ kind: "section", sectionId: "section-1" },
    [{ ...section(), content: "" }], [], "deliverable", "source-1", source), /saved.*response|empty/i);
});

test("reviewed, saved bid section creates content-bound evidence for a specifically selected section", () => {
  const proof = buildBidResponseEvidence({ kind: "section", sectionId: "section-1" },
    [section()], [], "deliverable", "source-1", source);
  assert.equal(proof.kind, "section");
  assert.equal(responseEvidenceIsCurrent(proof, [section()], [], "deliverable", "source-1", source), true);
  assert.equal(responseEvidenceIsCurrent(proof, [section({ content: "Revised response" })], [], "deliverable", "source-1", source), false);
  assert.equal(responseEvidenceIsCurrent(proof, [], [], "deliverable", "source-1", source), false);
  assert.equal(responseEvidenceIsCurrent(proof, [section()], [], "deliverable", "source-1",
    { ...source, fingerprint: "amended" }), false);
});

test("draft instructions and unresolved placeholders are not acceptable response proof", () => {
  assert.throws(() => buildBidResponseEvidence({ kind: "section", sectionId: "section-1" },
    [section({ content: "TODO: [NEEDS INPUT: devices]" })], [], "deliverable", "source-1", source), /placeholder/i);
  assert.throws(() => buildBidResponseEvidence({ kind: "section", sectionId: "section-1" },
    [section({ metadata: { ...section().metadata, sourceReviewRequired: true } })],
    [], "deliverable", "source-1", source), /source review/i);
  assert.throws(() => buildBidResponseEvidence({ kind: "section", sectionId: "section-1" },
    [section({ metadata: { ...section().metadata, pursuitSnapshotId: "snapshot-old" } })],
    [], "deliverable", "source-1", source), /current source/i);
});

test("a saved section from another bid cannot be used as completion evidence", () => {
  assert.throws(() => buildBidResponseEvidence({ kind: "section", sectionId: "other-bid-section" },
    [section()], [], "deliverable", "source-1", source), /this bid/i);
});

test("original form proof requires explicit form confirmation on the current source package", () => {
  assert.throws(() => buildBidResponseEvidence({ kind: "original_form" }, [section()], [],
    "form", "source-1", source), /confirm.*original/i);
  assert.throws(() => buildBidResponseEvidence({ kind: "original_form" }, [section()], ["source-1"],
    "deliverable", "source-1", source), /form/i);
  const proof = buildBidResponseEvidence({ kind: "original_form" }, [], ["source-1"],
    "form", "source-1", source);
  assert.equal(responseEvidenceIsCurrent(proof, [], ["source-1"], "form", "source-1", source), true);
  assert.equal(responseEvidenceIsCurrent(proof, [], [], "form", "source-1", source), false);
  assert.equal(responseEvidenceIsCurrent(proof, [], ["source-1"], "form", "source-1",
    { ...source, snapshotId: "new-snapshot" }), false);
});

test("legacy Complete rows without matching saved response evidence remain unverified", () => {
  assert.equal(responseEvidenceIsCurrent(undefined, [section()], ["source-1"], "form", "source-1", source), false);
  assert.equal(responseEvidenceIsCurrent({ kind: "section", sectionId: "section-1", contentFingerprint: "wrong",
    snapshotId: "snapshot-1", understandingId: "understanding-1", sourceFingerprint: "fingerprint-1" },
    [section()], [], "deliverable", "source-1", source), false);
});
