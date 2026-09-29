import assert from "node:assert/strict";
import test from "node:test";

import {
  assessFullBidGenerationReadiness,
  finalizeFullBidDraft,
  prepareFullBidDraftInput,
} from "./full-bid";

const snapshot = {
  pursuitSnapshotId: "11111111-1111-4111-8111-111111111111",
  documentSetFingerprint: "current-docs",
  currentDocumentSetFingerprint: "current-docs",
  snapshotStatus: "complete" as const,
  stale: false,
  staleReason: null,
  supersedesSnapshotId: null,
  totalDocumentCount: 2,
  storedDocumentCount: 2,
  blockedDocumentCount: 0,
  failedDocumentCount: 0,
  documents: [
    {
      id: "doc-scope",
      opportunityDocumentVersionId: "scope-v1",
      filename: "Scope of Work.pdf",
      status: "stored",
      failureCode: null,
      checksumSha256: "scope-sha",
    },
    {
      id: "doc-terms",
      opportunityDocumentVersionId: "terms-v1",
      filename: "Informal General Terms.docx",
      status: "stored",
      failureCode: null,
      checksumSha256: "terms-sha",
    },
  ],
};

const requirements = {
  understandingId: "22222222-2222-4222-8222-222222222222",
  completenessStatus: "complete" as const,
  incompleteReasons: [] as string[],
  isStale: false,
  requirements: [
    {
      id: "scope-1",
      requirementKey: "scope:deliver",
      type: "scope",
      level: "required",
      text: "Deliver and install the lift chair.",
      details: {},
      evidence: [{
        id: "evidence-scope",
        opportunityDocumentVersionId: "scope-v1",
        locator: { page: 3 },
        excerpt: "Contractor shall deliver and install the lift chair.",
      }],
      listingEvidence: null,
      metadata: {},
    },
    {
      id: "agency-terms",
      requirementKey: "agency:baseline",
      type: "legal",
      level: "required",
      text: "Standard City terms apply to all procurements.",
      details: { agencyBaseline: true },
      evidence: [{
        id: "evidence-terms",
        opportunityDocumentVersionId: "terms-v1",
        locator: { page: 1 },
        excerpt: "Standard City terms apply.",
      }],
      listingEvidence: null,
      metadata: { agencyBaseline: true },
    },
  ],
};

test("full bid generation is one current-source action and blocks an unreadable source with a concise recovery reason", () => {
  assert.deepEqual(
    assessFullBidGenerationReadiness({ snapshot, requirements }),
    { ready: true, blockers: [] },
  );

  const blocked = assessFullBidGenerationReadiness({
    snapshot: {
      ...snapshot,
      storedDocumentCount: 1,
      failedDocumentCount: 1,
      documents: snapshot.documents.map((document, index) =>
        index === 0 ? document : { ...document, status: "failed", failureCode: "download_failed" }),
    },
    requirements,
  });

  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.length, 1);
  assert.match(blocked.blockers[0]!, /Informal General Terms\.docx/);
  assert.match(blocked.blockers[0]!, /Retrieve source files/i);
});

test("generation input includes relevant solicitation evidence without generic agency-baseline fluff", () => {
  const prepared = prepareFullBidDraftInput({
    snapshot,
    requirements,
    company: null,
  });

  assert.equal(prepared.state, "ready");
  if (prepared.state !== "ready") return;
  assert.deepEqual(prepared.packet.requirementKeys, ["scope:deliver"]);
  assert.match(prepared.packet.sourceEvidence, /deliver and install the lift chair/i);
  assert.doesNotMatch(prepared.packet.sourceEvidence, /Standard City terms apply/);
  assert.match(prepared.packet.companyContext, /No company facts are available/i);
});

test("unknown vendor facts remain explicit Needs your input placeholders in the saved full bid", () => {
  const prepared = prepareFullBidDraftInput({
    snapshot,
    requirements,
    company: null,
  });
  assert.equal(prepared.state, "ready");
  if (prepared.state !== "ready") return;

  const final = finalizeFullBidDraft(prepared.packet, {
    content: "We will deliver the requested chair.",
    requirementKeys: ["scope:deliver"],
    missingFacts: ["Identify the offered manufacturer and model."],
  });

  assert.match(final.content, /Needs your input/i);
  assert.match(final.content, /Identify the offered manufacturer and model/i);
  assert.deepEqual(final.requirementKeys, ["scope:deliver"]);
});
