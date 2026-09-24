import assert from "node:assert/strict";
import test from "node:test";

import { explainComplianceRequirement } from "./compliance-guidance";
import type { BidWorkspaceRequirement } from "./workspace";

const row = (overrides: Partial<BidWorkspaceRequirement> = {}): BidWorkspaceRequirement => ({
  id: "row-1",
  sourceRequirementKey: "understanding-1:source-1",
  requirementType: "deliverable",
  text: "Provide three devices.",
  isRequired: true,
  status: "missing",
  effectiveStatus: "missing",
  canMarkComplete: true,
  evidence: {
    understandingId: "understanding-1", sourceRequirementId: "source-1",
    sourceFindingKey: "finding-1", requirementLevel: "required",
    pursuitSnapshotId: "snapshot-1", issues: [], references: [
      { snapshotDocumentId: "doc-1", opportunityDocumentVersionId: "version-1",
        filename: "Solicitation.pdf", checksumSha256: "hash",
        documentExtractionSegmentId: null, locator: { page: 2 }, excerpt: "Provide three devices." },
    ],
  },
  responseNotes: null,
  sortOrder: 0,
  ...overrides,
});

const context = { workspaceId: "bid-1", sourceReady: true, snapshotCurrent: true, understandingCurrent: true,
  currentSnapshotId: "snapshot-1", currentUnderstandingId: "understanding-1" };

test("current pinned evidence allows addressed and explains what the person must verify", () => {
  const state = explainComplianceRequirement(row(), context);
  assert.equal(state.canComplete, true);
  assert.equal(state.kind, "actionable");
  assert.match(state.explanation, /your bid|response/i);
  assert.match(state.nextAction, /response notes|response section/i);
});

test("source documents or incomplete understanding give different exact unblock instructions", () => {
  const snapshot = explainComplianceRequirement(row({ canMarkComplete: false }), {
    ...context, sourceReady: false, snapshotCurrent: false,
  });
  assert.equal(snapshot.canComplete, false);
  assert.equal(snapshot.link.href, "#source-snapshot");
  assert.match(snapshot.explanation, /original|snapshot/i);

  const understanding = explainComplianceRequirement(row({ canMarkComplete: false }), {
    ...context, sourceReady: false, understandingCurrent: false,
  });
  assert.equal(understanding.link.href, "#source-requirements");
  assert.match(understanding.explanation, /understanding/i);
});

test("prior approval and changed source are visibly needs re-review, not addressed", () => {
  const state = explainComplianceRequirement(row({
    status: "complete", effectiveStatus: "needs_review", canMarkComplete: false,
    evidence: { ...row().evidence, pursuitSnapshotId: "snapshot-old" },
  }), context);
  assert.equal(state.kind, "blocked");
  assert.equal(state.canComplete, false);
  assert.match(state.explanation, /previous|earlier|changed/i);
  assert.equal(state.link.href, "#source-snapshot");
});

test("unknown requiredness explicitly needs authoritative clarification and cannot be bypassed", () => {
  const state = explainComplianceRequirement(row({
    canMarkComplete: false, status: "needs_review", effectiveStatus: "needs_review",
    evidence: { ...row().evidence, requirementLevel: "unknown",
      issues: ["requirement_requiredness_unknown"] },
  }), context);
  assert.equal(state.canComplete, false);
  assert.match(state.explanation, /mandatory|required/i);
  assert.match(state.nextAction, /original/i);
  assert.equal(state.link.href, "/bids/bid-1/evidence/row-1");
});

test("missing source evidence explains the repair action without suggesting another paid AI call", () => {
  const state = explainComplianceRequirement(row({
    canMarkComplete: false,
    evidence: { ...row().evidence, issues: ["requirement_evidence_missing"], references: [] },
  }), context);
  assert.equal(state.canComplete, false);
  assert.match(state.explanation, /evidence/i);
  assert.match(state.nextAction, /original|evidence/i);
  assert.doesNotMatch(state.nextAction, /AI|regenerat.*AI/i);
});

test("status classification honors effective saved status and unverified vendor facts remain separate", () => {
  const completed = explainComplianceRequirement(row({
    status: "complete", effectiveStatus: "complete",
  }), context);
  assert.equal(completed.kind, "addressed");
  assert.match(completed.explanation, /not.*vendor|not.*certif/i);
  assert.equal(explainComplianceRequirement(row({ status: "drafting", effectiveStatus: "drafting" }), context).kind, "actionable");
  assert.equal(explainComplianceRequirement(row({ canMarkComplete: false }), context).kind, "blocked");
});
