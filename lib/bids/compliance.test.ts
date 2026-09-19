import assert from "node:assert/strict";
import test from "node:test";

import { planComplianceMatrix, resolveComplianceStatus } from "./compliance";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";
import type { BidWorkspaceSourceSnapshot } from "./workspace";

const requirement = (id: string, type: string, version: string): PersistedSolicitationRequirement => ({
  id,
  requirementKey: `submissionComponents:${id}`,
  type,
  level: "required",
  text: `Submit ${type} for the bid`,
  sourceSection: "submissionComponents",
  sourceFindingKey: `finding-${id}`,
  details: {},
  evidence: [{ opportunityDocumentVersionId: version, documentExtractionSegmentId: "segment-1", locator: { page: 4, section: "Submission" }, excerpt: "Submission is mandatory." }],
});

const snapshot = (overrides: Partial<BidWorkspaceSourceSnapshot> = {}): BidWorkspaceSourceSnapshot => ({
  pursuitSnapshotId: "snapshot-v1",
  documentSetFingerprint: "hash-v1",
  currentDocumentSetFingerprint: "hash-v1",
  snapshotStatus: "complete",
  stale: false,
  staleReason: null,
  supersedesSnapshotId: null,
  totalDocumentCount: 4,
  storedDocumentCount: 4,
  blockedDocumentCount: 0,
  failedDocumentCount: 0,
  documents: [
    { id: "doc-main", opportunityDocumentVersionId: "v-main", filename: "Solicitation.pdf", status: "stored", failureCode: null, checksumSha256: "hash-main" },
    { id: "doc-form", opportunityDocumentVersionId: "v-form", filename: "Required Form.pdf", status: "stored", failureCode: null, checksumSha256: "hash-form" },
    { id: "doc-price", opportunityDocumentVersionId: "v-price", filename: "Pricing.xlsx", status: "stored", failureCode: null, checksumSha256: "hash-price" },
    { id: "doc-addendum", opportunityDocumentVersionId: "v-addendum", filename: "Addendum 1.pdf", status: "stored", failureCode: null, checksumSha256: "hash-addendum" },
  ],
  ...overrides,
});

test("plans each required form, pricing sheet, certification, insurance, bond and addendum with immutable snapshot evidence", () => {
  const requirements = [
    requirement("form", "form", "v-form"),
    requirement("pricing", "pricing", "v-price"),
    requirement("certification", "certification", "v-addendum"),
    requirement("insurance", "insurance", "v-main"),
    requirement("bond", "bonding", "v-main"),
  ];
  const result = planComplianceMatrix({
    understandingId: "understanding-1",
    requirements,
    completenessStatus: "complete",
    understandingStale: false,
    snapshot: snapshot(),
  });
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((r) => r.requirementType), ["form", "pricing", "certification", "insurance", "bonding"]);
  for (const row of result) {
    assert.equal(row.status, "missing");
    assert.equal(row.isRequired, true);
    assert.equal(row.evidence.pursuitSnapshotId, "snapshot-v1");
    assert.equal(row.evidence.references.length, 1);
    assert.equal(row.evidence.references[0]?.locator.page, 4);
    assert.equal(row.evidence.issues.length, 0);
  }
  assert.equal(result[0]?.evidence.references[0]?.snapshotDocumentId, "doc-form");
  assert.equal(result[1]?.evidence.references[0]?.opportunityDocumentVersionId, "v-price");
  assert.equal(result[2]?.evidence.references[0]?.filename, "Addendum 1.pdf");
  assert.equal(result[2]?.evidence.references[0]?.checksumSha256, "hash-addendum");
});

test("optional requirements remain optional and unproven or un-snapshotted requirements need review", () => {
  const missingProof = { ...requirement("references", "qualification", "v-main"), level: "optional", evidence: [] };
  const wrongVersion = requirement("drawing", "work", "v-not-in-snapshot");
  const result = planComplianceMatrix({
    understandingId: "u",
    requirements: [missingProof, wrongVersion],
    completenessStatus: "complete",
    understandingStale: false,
    snapshot: snapshot(),
  });
  assert.equal(result[0]?.isRequired, false);
  assert.equal(result[0]?.status, "needs_review");
  assert.deepEqual(result[0]?.evidence.issues, ["requirement_evidence_missing"]);
  assert.equal(result[1]?.status, "needs_review");
  assert.deepEqual(result[1]?.evidence.issues, ["document_version_outside_snapshot"]);
  assert.equal(result[1]?.evidence.references[0]?.opportunityDocumentVersionId, "v-not-in-snapshot");
  assert.equal(result[1]?.evidence.references[0]?.snapshotDocumentId, null);
});

test("an incomplete or stale source set never presents completed rows as complete", () => {
  const [row] = planComplianceMatrix({
    understandingId: "u",
    requirements: [requirement("form", "form", "v-form")],
    completenessStatus: "partial",
    understandingStale: false,
    snapshot: snapshot({ snapshotStatus: "blocked", documents: snapshot().documents.map((doc) => doc.id === "doc-form" ? { ...doc, status: "blocked", failureCode: "auth_blocked" } : doc) }),
  });
  assert.equal(row?.status, "needs_review");
  assert.ok(row?.evidence.issues.includes("requirement_set_incomplete"));
  assert.ok(row?.evidence.issues.includes("snapshot_incomplete"));
  assert.ok(row?.evidence.issues.includes("evidence_document_unavailable"));
  assert.equal(resolveComplianceStatus("complete", row!.evidence, snapshot(), "u"), "needs_review");
});

test("new amendments and current-document changes mark prior complete responses stale without rewriting historical references", () => {
  const [row] = planComplianceMatrix({
    understandingId: "u",
    requirements: [requirement("pricing", "pricing", "v-price")],
    completenessStatus: "complete",
    understandingStale: false,
    snapshot: snapshot(),
  });
  assert.equal(resolveComplianceStatus("complete", row!.evidence, snapshot(), "u"), "complete");
  const newer = snapshot({
    pursuitSnapshotId: "snapshot-v2",
    documentSetFingerprint: "hash-v2",
    currentDocumentSetFingerprint: "hash-v2",
    stale: true,
    documents: [...snapshot().documents, { id: "new-addendum", opportunityDocumentVersionId: "v-addendum-2", filename: "Addendum 2.pdf", status: "stored", failureCode: null, checksumSha256: "hash-addendum-2" }],
  });
  assert.equal(resolveComplianceStatus("complete", row!.evidence, newer, "u"), "needs_review");
  assert.equal(row!.evidence.references[0]?.snapshotDocumentId, "doc-price");
  assert.equal(row!.evidence.pursuitSnapshotId, "snapshot-v1");
  assert.equal(resolveComplianceStatus("complete", row!.evidence, snapshot(), "new-understanding"), "needs_review");
});

test("requirements are deterministic and repeat planning does not alter keys or evidence", () => {
  const input = {
    understandingId: "u",
    requirements: [requirement("form", "form", "v-form")],
    completenessStatus: "complete" as const,
    understandingStale: false,
    snapshot: snapshot(),
  };
  assert.deepEqual(planComplianceMatrix(input), planComplianceMatrix(input));
  assert.equal(planComplianceMatrix(input)[0]?.sourceRequirementKey, "u:form");
});
