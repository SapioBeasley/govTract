import assert from "node:assert/strict";
import test from "node:test";

import { prepareBidDraftInput, finalizeBidDraft } from "@/lib/bids/draft-input";
import type { BidWorkspaceSection, BidWorkspaceSourceSnapshot } from "@/lib/bids/workspace";
import type { SolicitationRequirementSet } from "@/lib/procurement/requirements/persistence";

const versionId = "00000000-0000-4000-8000-000000000001";
const snapshotId = "00000000-0000-4000-8000-000000000002";
const understandingId = "00000000-0000-4000-8000-000000000003";

function snapshot(): BidWorkspaceSourceSnapshot {
  return {
    pursuitSnapshotId: snapshotId,
    documentSetFingerprint: "fingerprint-1",
    currentDocumentSetFingerprint: "fingerprint-1",
    snapshotStatus: "complete", stale: false, staleReason: null,
    supersedesSnapshotId: null, totalDocumentCount: 1, storedDocumentCount: 1,
    blockedDocumentCount: 0, failedDocumentCount: 0,
    documents: [{ id: "snapshot-document-1", opportunityDocumentVersionId: versionId,
      filename: "Addendum pricing form.xlsx", status: "stored", failureCode: null, checksumSha256: "a".repeat(64) }],
  };
}
function section(): BidWorkspaceSection {
  return {
    id: "section-1", title: "Pricing response",
    instructions: "Use the mandatory pricing sheet.", content: null,
    status: "draft", requirementLinks: { sourceRequirementKeys: ["pricing:1"] },
    sortOrder: 0, wordCount: 0,
    metadata: { understandingId, pursuitSnapshotId: snapshotId, documentSetFingerprint: "fingerprint-1" },
  };
}
function source(): SolicitationRequirementSet {
  return {
    understandingId, completenessStatus: "complete", incompleteReasons: [], isStale: false,
    requirements: [{ id: "r1", requirementKey: "pricing:1", type: "pricing", level: "required",
      text: "Use the agency pricing sheet.", sourceSection: "pricingInstructions",
      sourceFindingKey: "finding-1", details: {},
      evidence: [{ opportunityDocumentVersionId: versionId, documentExtractionSegmentId: "segment-1",
        locator: { sheet: "Rates" }, excerpt: "Complete rates in the supplied worksheet." }] }],
  };
}

test("manual drafting packet is pinned to the complete immutable solicitation snapshot and supported requirement evidence", () => {
  const result = prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements: source(),
    company: { name: "Example LLC", capabilities: ["Consulting"] } });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.equal(result.packet.snapshotId, snapshotId);
  assert.equal(result.packet.documentSetFingerprint, "fingerprint-1");
  assert.deepEqual(result.packet.sourceDocumentVersions.map((d) => d.versionId), [versionId]);
  assert.deepEqual(result.packet.requirementKeys, ["pricing:1"]);
  assert.match(result.packet.sourceEvidence, /Complete rates in the supplied worksheet/);
  assert.match(result.packet.sourceEvidence, /Addendum pricing form\.xlsx/);
  assert.match(result.packet.companyContext, /unverified/i);
  assert.ok(result.packet.requiredQuestions.some((q) => /pricing/i.test(q)));
  assert.match(result.packet.inputFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements: source(),
      company: { name: "Example LLC", capabilities: ["Consulting"] } }),
    result,
  );
});

test("stale, incomplete or unverified source documents never reach model drafting", () => {
  for (const change of [
    (s: BidWorkspaceSourceSnapshot) => { s.stale = true; },
    (s: BidWorkspaceSourceSnapshot) => { s.snapshotStatus = "incomplete"; },
    (s: BidWorkspaceSourceSnapshot) => { s.currentDocumentSetFingerprint = "amendment-2"; },
    (s: BidWorkspaceSourceSnapshot) => { s.documents[0]!.status = "blocked"; },
    (s: BidWorkspaceSourceSnapshot) => { s.documents[0]!.opportunityDocumentVersionId = "another-version"; },
    (s: BidWorkspaceSourceSnapshot) => { s.documents[0]!.checksumSha256 = null; },
  ]) {
    const s = snapshot(); change(s);
    assert.equal(prepareBidDraftInput({ snapshot: s, section: section(), requirements: source(), company: null }).state, "blocked");
  }
  const metadataOnly = source(); metadataOnly.requirements[0]!.evidence = [];
  assert.equal(prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements: metadataOnly, company: null }).state, "blocked");
  const amended = source(); amended.isStale = true;
  assert.equal(prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements: amended, company: null }).state, "blocked");
  const mismatched = section(); mismatched.metadata.understandingId = "outdated";
  assert.equal(prepareBidDraftInput({ snapshot: snapshot(), section: mismatched, requirements: source(), company: null }).state, "blocked");
});

test("model output never adds unsupported requirement citations and missing facts are explicit placeholders", () => {
  const prep = prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements: source(), company: null });
  assert.equal(prep.state, "ready");
  if (prep.state !== "ready") return;
  const final = finalizeBidDraft(prep.packet, { content: "Rates will be supplied after review.",
    requirementKeys: ["pricing:1"], missingFacts: ["Provide final unit pricing"] });
  assert.match(final.content, /\[NEEDS INPUT: Provide final unit pricing\]/);
  assert.match(final.content, /\[NEEDS INPUT: .*pricing/i);
  assert.deepEqual(final.requirementKeys, ["pricing:1"]);
  assert.throws(() => finalizeBidDraft(prep.packet, { content: "Approved.", requirementKeys: ["unrelated"], missingFacts: [] }),
    /unsupported requirement/i);
});
