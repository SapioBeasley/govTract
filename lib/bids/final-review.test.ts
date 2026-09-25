import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { evaluateBidFinalReview } from "@/lib/bids/final-review";
import type { RequirementResponseEvidence } from "@/lib/bids/response-proof";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

const version = "version-1";
const checksum = "a".repeat(64);
const fingerprint = "b".repeat(64);
const sourceId = "understanding-1";

function fixture() {
  const snapshot = {
    pursuitSnapshotId: "snapshot-1",
    documentSetFingerprint: fingerprint,
    currentDocumentSetFingerprint: fingerprint,
    snapshotStatus: "complete" as "complete" | "incomplete" | "blocked" | "unknown",
    stale: false,
    staleReason: null,
    supersedesSnapshotId: null,
    totalDocumentCount: 1,
    storedDocumentCount: 1,
    blockedDocumentCount: 0,
    failedDocumentCount: 0,
    documents: [{ id: "snapshot-document-1", opportunityDocumentVersionId: version,
      filename: "Original pricing form.xlsx", status: "stored", failureCode: null, checksumSha256: checksum }],
  };
  const sourceRequirement = {
    id: "source-form-1", requirementKey: "submissionComponents:form-1", type: "form",
    level: "required", text: "Complete and sign the original pricing form.xlsx.",
    sourceSection: "submissionComponents", sourceFindingKey: "form-1",
    details: { requiredFileName: "Original pricing form.xlsx" },
    evidence: [{ opportunityDocumentVersionId: version, documentExtractionSegmentId: null,
      locator: { page: 2 }, excerpt: "Original pricing form.xlsx must be signed." }],
  };
  const submission = {
    id: "source-submit-1", requirementKey: "submissionComponents:portal", type: "submission_instruction",
    level: "required", text: "Upload the signed form to the external bidding portal as an XLSX.",
    sourceSection: "submissionComponents", sourceFindingKey: "portal",
    details: { fileFormat: "XLSX" },
    evidence: [{ opportunityDocumentVersionId: version, documentExtractionSegmentId: null,
      locator: { page: 3 }, excerpt: "Upload signed form to portal." }],
  };
  const requirements: PersistedSolicitationRequirement[] = [sourceRequirement, submission];
  const workspaceRequirements = requirements.map((requirement) => ({
    id: requirement.id, sourceRequirementKey: `${sourceId}:${requirement.id}`,
    requirementType: requirement.type, text: requirement.text, isRequired: true,
    status: "complete", effectiveStatus: "complete" as "complete" | "needs_review", canMarkComplete: true,
    evidence: {}, responseNotes: null, sortOrder: 0,
    // A clean fixture represents a bidder who has actually prepared and reviewed
    // the original form or saved section; buyer citations alone are not enough.
    responseEvidence: requirement.type === "form"
      ? { kind: "original_form" as const, sourceRequirementId: requirement.id, snapshotId: "snapshot-1",
          sourceFingerprint: fingerprint, understandingId: sourceId }
      : { kind: "section" as const, sectionId: "section-1",
          contentFingerprint: createHash("sha256").update("We will perform the requested work.").digest("hex"),
          snapshotId: "snapshot-1", sourceFingerprint: fingerprint, understandingId: sourceId } as RequirementResponseEvidence | null,
  }));
  return {
    workspace: {
      dueAt: new Date("2026-10-15T22:00:00Z") as Date | null,
      agencyBaselineReviewCurrent: false,
      sourceSnapshot: snapshot,
      sourceRequirements: { understandingId: sourceId, completenessStatus: "complete" as const,
        incompleteReasons: [], isStale: false, requirements },
      requirements: workspaceRequirements,
      sections: [{ id: "section-1", title: "Technical response", instructions: "Describe approach",
        content: "We will perform the requested work.", status: "draft",
        requirementLinks: {}, sortOrder: 0, wordCount: 7, metadata: {} }],
    },
    portalUrl: "https://www.beaconbid.com/solicitations/city-of-houston/open" as string | null,
    confirmedOriginalForms: ["source-form-1"],
    now: new Date("2026-09-19T22:00:00Z"),
  };
}


test("a source-verified Complete checkbox alone cannot pass final review without saved bidder response proof", () => {
  const input = fixture();
  // This fixture represents a legacy Complete saved before bidder-response proof existed.
  input.workspace.requirements[0]!.responseEvidence = null;
  const result = evaluateBidFinalReview(input);
  assert.equal(result.readyForHumanReview, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === "mandatory_requirement_incomplete" &&
    issue.requirementId === "source-form-1"));
});

test("an edited saved response needs compliance re-review even if its old Complete status persists", () => {
  const input = fixture();
  input.workspace.requirements[1]!.responseEvidence = {
    kind: "section" as const, sectionId: "section-1",
    contentFingerprint: "old-draft-fingerprint", snapshotId: "snapshot-1",
    sourceFingerprint: fingerprint, understandingId: sourceId,
  };
  const result = evaluateBidFinalReview(input);
  assert.equal(result.readyForHumanReview, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === "mandatory_requirement_incomplete" &&
    issue.requirementId === "source-submit-1"));
});

test("complete, current source versions and explicitly confirmed original source forms permit human final review", () => {
  const result = evaluateBidFinalReview(fixture());
  assert.deepEqual(result.blockingIssues, []);
  assert.equal(result.readyForHumanReview, true);
  assert.equal(result.readyForExternalSubmission, false, "a computed checklist never claims external submission");
  assert.equal(result.submission.portalUrl, fixture().portalUrl);
  assert.equal(result.submission.dueAt?.toISOString(), "2026-10-15T22:00:00.000Z");
  assert.equal(result.sourceChecks[0]?.references[0]?.opportunityDocumentVersionId, version);
  assert.equal(result.sourceChecks[0]?.references[0]?.checksumSha256, checksum);
  assert.equal(result.sourceChecks[0]?.originalRequired, true);
});

test("missing, failed, and blocked source files prevent a clean review, even if compliance was marked complete", () => {
  for (const status of ["missing", "failed", "blocked", "pending"]) {
    const input = fixture();
    input.workspace.sourceSnapshot.snapshotStatus = "incomplete";
    input.workspace.sourceSnapshot.documents[0]!.status = status;
    const result = evaluateBidFinalReview(input);
    assert.equal(result.readyForHumanReview, false, status);
    assert.ok(result.blockingIssues.some((issue) => issue.code === "source_document_unavailable"));
  }
});

test("newer authoritative document version invalidates previous review without overwriting historical evidence", () => {
  const input = fixture();
  input.workspace.sourceSnapshot.currentDocumentSetFingerprint = "new-amendment";
  input.workspace.sourceSnapshot.stale = true;
  const result = evaluateBidFinalReview(input);
  assert.equal(result.readyForHumanReview, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === "source_snapshot_stale"));
  assert.equal(result.sourceChecks[0]?.references[0]?.opportunityDocumentVersionId, version);
});

test("required original forms cannot be replaced by generated text or a completed compliance row", () => {
  const input = fixture();
  input.confirmedOriginalForms = [];
  const result = evaluateBidFinalReview(input);
  assert.equal(result.readyForHumanReview, false);
  assert.ok(result.blockingIssues.some((issue) => issue.code === "original_form_unconfirmed"));
  assert.equal(result.sourceChecks[0]?.originalRequired, true);
});

test("stale or absent compliance, unknown requiredness, incomplete sections and placeholders block review", () => {
  const input = fixture();
  input.workspace.requirements[0]!.effectiveStatus = "needs_review";
  input.workspace.sourceRequirements.requirements[1]!.level = "unknown";
  input.workspace.sections[0]!.content = "TODO: [NEEDS INPUT: add certifications]";
  const result = evaluateBidFinalReview(input);
  for (const code of ["mandatory_requirement_incomplete", "requiredness_unverified", "section_placeholder"]) {
    assert.ok(result.blockingIssues.some((issue) => issue.code === code), code);
  }
  input.workspace.sections[0]!.content = "  ";
  assert.ok(evaluateBidFinalReview(input).blockingIssues.some((issue) => issue.code === "section_incomplete"));
});

test("missing submission channel, deadline, source evidence, and explicit source instructions block readiness", () => {
  const input = fixture();
  input.portalUrl = null;
  input.workspace.dueAt = null;
  input.workspace.sourceRequirements.requirements[1]!.evidence = [];
  const result = evaluateBidFinalReview(input);
  for (const code of ["submission_portal_unverified", "submission_deadline_unverified", "source_evidence_unverified"]) {
    assert.ok(result.blockingIssues.some((issue) => issue.code === code), code);
  }
});

test("review fingerprint changes when a draft, mandatory response, form acknowledgement, or snapshot changes", () => {
  const input = fixture();
  const initial = evaluateBidFinalReview(input).reviewFingerprint;
  input.workspace.sections[0]!.content = "New draft";
  assert.notEqual(evaluateBidFinalReview(input).reviewFingerprint, initial);
  input.workspace.sections[0]!.content = "We will perform the requested work.";
  input.confirmedOriginalForms = [];
  assert.notEqual(evaluateBidFinalReview(input).reviewFingerprint, initial);
  input.confirmedOriginalForms = ["source-form-1"];
  input.workspace.sourceSnapshot.currentDocumentSetFingerprint = "amended";
  assert.notEqual(evaluateBidFinalReview(input).reviewFingerprint, initial);
});


test("saved AI sections require content-bound verified vendor approval even when missing-fact questions are absent", () => {
  const input = fixture();
  const section = input.workspace.sections[0]!;
  section.content = "We will provide a certified basket and insurance coverage.";
  section.metadata = { aiDraftReview: { generationId: "generation-180" } };
  const pending = evaluateBidFinalReview(input);
  assert.ok(pending.blockingIssues.some((issue) => issue.code === "ai_vendor_facts_unverified"));
  assert.equal(pending.readyForHumanReview, false);

  section.metadata = {
    aiDraftReview: { generationId: "generation-180" },
    verifiedVendorFactsFingerprint: "approval-for-different-text",
  };
  assert.ok(evaluateBidFinalReview(input).blockingIssues.some((issue) => issue.code === "ai_vendor_facts_unverified"));
});

test("audited original-source decision changes effective mandatory status and preserves original AI output", () => {
  const input = fixture();
  const instruction = input.workspace.sourceRequirements.requirements[1]!;
  instruction.level = "unknown";
  const original = structuredClone(instruction);
  input.workspace.requirements[1]!.evidence = {
    understandingId: sourceId, sourceRequirementId: instruction.id, sourceFindingKey: instruction.sourceFindingKey,
    pursuitSnapshotId: "snapshot-1", requirementLevel: "required", issues: [],
    references: [{ snapshotDocumentId: "snapshot-document-1", opportunityDocumentVersionId: version,
      filename: "Original pricing form.xlsx", checksumSha256: checksum,
      documentExtractionSegmentId: "segment-1", locator: { page: 3 },
      excerpt: "Upload signed form to portal." }],
  };
  const checked = evaluateBidFinalReview(input);
  assert.equal(checked.blockingIssues.some((issue) => issue.code === "requiredness_unverified"), false);
  assert.equal(checked.sourceChecks[1]?.mandatory, true);
  assert.deepEqual(instruction, original, "stored source understanding is not rewritten");
});


test("shared agency baseline terms require one current aggregate review instead of prose response proof for every boilerplate rule", () => {
  const input = fixture();
  const baseline: PersistedSolicitationRequirement = {
    id: "source-standard-terms",
    requirementKey: "pricing:standard-terms",
    type: "pricing",
    level: "required",
    text: "Hold pricing contained within the informal bid for a minimum of 90 days.",
    sourceSection: "pricingInstructions",
    sourceFindingKey: "standard-terms",
    details: { sourceDocumentRole: "agency_baseline" },
    evidence: [{ opportunityDocumentVersionId: version, documentExtractionSegmentId: "segment-terms",
      locator: { page: 1 }, excerpt: "Hold pricing contained within the informal bid for a minimum of 90 days." }],
  };
  input.workspace.sourceRequirements.requirements.push(baseline);
  input.workspace.requirements.push({
    id: baseline.id,
    sourceRequirementKey: sourceId + ":" + baseline.id,
    requirementType: baseline.type,
    text: baseline.text,
    isRequired: true,
    status: "missing",
    effectiveStatus: "needs_review",
    canMarkComplete: true,
    evidence: {},
    responseNotes: null,
    sortOrder: 2,
    responseEvidence: null,
  });

  input.workspace.agencyBaselineReviewCurrent = false;
  const pending = evaluateBidFinalReview(input);
  assert.equal(pending.blockingIssues.filter((issue) =>
    issue.code === "agency_baseline_terms_unreviewed").length, 1);
  assert.equal(pending.blockingIssues.some((issue) =>
    issue.code === "mandatory_requirement_incomplete" && issue.requirementId === baseline.id), false);

  input.workspace.agencyBaselineReviewCurrent = true;
  const reviewed = evaluateBidFinalReview(input);
  assert.equal(reviewed.blockingIssues.some((issue) =>
    issue.code === "agency_baseline_terms_unreviewed"), false);
  assert.equal(reviewed.blockingIssues.some((issue) =>
    issue.code === "mandatory_requirement_incomplete" && issue.requirementId === baseline.id), false);
});
