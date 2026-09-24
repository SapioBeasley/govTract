import assert from "node:assert/strict";
import test from "node:test";

import { deriveBidGuidance } from "./guided-progress";
import type { BidWorkspaceRecord } from "./workspace";

function fixture(overrides: Record<string, unknown> = {}): BidWorkspaceRecord {
  const fingerprint = "source-v1";
  const workspace = {
    id: "bid-1",
    opportunityId: "opportunity-1",
    reviewState: "not_started",
    sourceSnapshot: {
      pursuitSnapshotId: "snapshot-1",
      snapshotStatus: "complete",
      documentSetFingerprint: fingerprint,
      currentDocumentSetFingerprint: fingerprint,
      stale: false,
      totalDocumentCount: 3,
      storedDocumentCount: 3,
      blockedDocumentCount: 0,
      failedDocumentCount: 0,
      documents: [1, 2, 3].map((id) => ({
        id: `doc-${id}`, opportunityDocumentVersionId: `version-${id}`,
        filename: `original-${id}.pdf`, status: "stored", failureCode: null, checksumSha256: `hash-${id}`,
      })),
    },
    sourceRequirements: {
      understandingId: "understanding-1", isStale: false, completenessStatus: "complete",
      incompleteReasons: [], requirements: [{ id: "source-1", evidence: [{ excerpt: "Original text" }] }],
    },
    requirements: [{
      id: "compliance-1", sourceRequirementKey: "understanding-1:source-1",
      effectiveStatus: "complete", status: "complete", isRequired: true,
    }],
    sections: ["Technical response", "Pricing response"].map((title, index) => ({
      id: `section-${index}`, title, content: "Saved response",
      metadata: { pursuitSnapshotId: "snapshot-1", understandingId: "understanding-1",
        documentSetFingerprint: fingerprint },
    })),
    finalReview: {
      blockingIssues: [], readyForHumanReview: true,
      sourceChecks: [], readyForExternalSubmission: false,
    },
    confirmedOriginalForms: [],
    finalReviewApprovalCurrent: false,
    ...overrides,
  };
  return workspace as unknown as BidWorkspaceRecord;
}

test("pending and failed source originals lead to a bounded recovery action, not drafting", () => {
  for (const status of ["pending", "failed"]) {
    const workspace = fixture();
    workspace.sourceSnapshot.documents[0]!.status = status;
    const progress = deriveBidGuidance(workspace);
    assert.equal(progress.nextAction.stepId, "sources");
    assert.equal(progress.nextAction.href, "#source-snapshot");
    assert.match(progress.nextAction.reason, /original|source/i);
    assert.equal(progress.steps.find((step) => step.id === "sources")?.status, "Blocked");
  }
});

test("an amended snapshot and incomplete understanding block source-dependent steps", () => {
  const amended = fixture();
  amended.sourceSnapshot.stale = true;
  amended.sourceSnapshot.currentDocumentSetFingerprint = "source-v2";
  assert.equal(deriveBidGuidance(amended).nextAction.href, "#source-snapshot");

  const partial = fixture();
  partial.sourceRequirements!.completenessStatus = "partial";
  partial.sourceRequirements!.incompleteReasons = ["unverified_quantity"];
  const action = deriveBidGuidance(partial).nextAction;
  assert.equal(action.stepId, "sources");
  assert.match(action.reason, /unverified_quantity/);
  assert.equal(action.href, "#source-requirements");
});

test("current understanding and old outline request explicit original review before reconciliation", () => {
  const workspace = fixture();
  workspace.sections[0]!.metadata.documentSetFingerprint = "old-source";
  const progress = deriveBidGuidance(workspace);
  assert.equal(progress.nextAction.stepId, "reconcile");
  assert.equal(progress.nextAction.href, "#source-snapshot");
  assert.match(progress.nextAction.reason, /original/i);
});

test("only the preserved Technical response requires source re-review and Save section", () => {
  const workspace = fixture();
  workspace.sections[0]!.metadata.sourceReviewRequired = true;
  const progress = deriveBidGuidance(workspace);
  assert.equal(progress.nextAction.href, "#response-section-section-0");
  assert.match(progress.nextAction.reason, /Save section/);
  assert.equal(progress.steps.find((step) => step.id === "sections")?.count, 1);
  assert.equal(progress.steps.find((step) => step.id === "compliance")?.status, "Complete");
});

test("five empty response sections stay grouped as five distinct outstanding actions", () => {
  const workspace = fixture();
  workspace.sections = Array.from({ length: 5 }, (_, index) => ({
    ...workspace.sections[0]!, id: `section-${index}`, title: `Section ${index}`,
    content: "",
  }));
  workspace.finalReview.blockingIssues = workspace.sections.map((section) => ({
    code: "section_incomplete", message: `${section.title} is empty`, sectionId: section.id,
  }));
  const progress = deriveBidGuidance(workspace);
  assert.equal(progress.steps.find((step) => step.id === "sections")?.count, 5);
  assert.equal(progress.groupedIssues.reduce((total, group) => total + group.issues.length, 0), 5);
  assert.equal(progress.nextAction.href, "#response-section-section-0");
});

test("after generating the checklist, next action is to draft a bid section before completion", () => {
  const workspace = fixture();
  workspace.sections = [];
  workspace.requirements[0]!.status = "missing";
  workspace.requirements[0]!.effectiveStatus = "missing";
  workspace.finalReview.readyForHumanReview = false;
  workspace.finalReview.blockingIssues = [
    { code: "mandatory_requirement_incomplete", message: "Bid response missing", requirementId: "source-1" },
    { code: "response_sections_missing", message: "Create the bid outline" },
  ];
  const guidance = deriveBidGuidance(workspace);
  assert.equal(guidance.nextAction.stepId, "sections");
  assert.equal(guidance.nextAction.href, "#response-sections");
  assert.match(guidance.nextAction.reason, /outline|draft|response/i);
});

test("when all bid sections are empty, draft before trying to complete mandatory items", () => {
  const workspace = fixture();
  workspace.sections.forEach((section) => { section.content = ""; });
  workspace.finalReview.readyForHumanReview = false;
  workspace.finalReview.blockingIssues = [
    { code: "mandatory_requirement_incomplete", message: "Bid response missing", requirementId: "source-1" },
    { code: "section_incomplete", message: "Technical response is empty", sectionId: "section-0" },
  ];
  const guidance = deriveBidGuidance(workspace);
  assert.equal(guidance.nextAction.stepId, "sections");
  assert.equal(guidance.nextAction.href, "#response-section-section-0");
});

test("compliance blockers link to the exact requirement and are not double-counted", () => {
  const workspace = fixture();
  workspace.finalReview.blockingIssues = [
    { code: "requiredness_unverified", message: "Determine mandatory status", requirementId: "source-1" },
    { code: "mandatory_requirement_incomplete", message: "Record response", requirementId: "source-1" },
  ];
  const progress = deriveBidGuidance(workspace);
  assert.equal(progress.steps.find((step) => step.id === "compliance")?.count, 2);
  assert.equal(progress.nextAction.href, "#compliance-requirement-compliance-1");
  assert.equal(progress.groupedIssues.reduce((total, group) => total + group.issues.length, 0), 2);
});

test("original forms, stale approval, and human handoff never imply automatic submission", () => {
  const workspace = fixture();
  workspace.finalReview.sourceChecks = [{
    requirementId: "source-1", originalRequired: true, originalConfirmed: false,
  }] as BidWorkspaceRecord["finalReview"]["sourceChecks"];
  workspace.finalReview.blockingIssues = [{
    code: "original_form_unconfirmed", message: "Confirm original", requirementId: "source-1",
  }];
  assert.equal(deriveBidGuidance(workspace).nextAction.href, "#original-form-source-1");

  workspace.finalReview.blockingIssues = [];
  workspace.finalReview.sourceChecks = [];
  workspace.reviewState = "approved";
  assert.equal(deriveBidGuidance(workspace).steps.find((step) => step.id === "handoff")?.status, "Needs re-review");
  workspace.finalReviewApprovalCurrent = true;
  const approved = deriveBidGuidance(workspace);
  assert.equal(approved.steps.find((step) => step.id === "handoff")?.status, "Complete");
  assert.match(approved.steps.find((step) => step.id === "handoff")!.description, /external portal/i);
});
