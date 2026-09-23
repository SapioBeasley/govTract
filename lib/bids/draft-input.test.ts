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

function fixtureRequirement(
  key: string,
  type: string,
  excerpt: string | null,
  segmentId: string,
  details: Record<string, unknown> = {},
) {
  return {
    id: key, requirementKey: key, type, level: "required", text: "Provide assembled basket and tested weight.",
    sourceSection: "scope", sourceFindingKey: key, details,
    evidence: excerpt === null ? [] : [{
      opportunityDocumentVersionId: versionId, documentExtractionSegmentId: segmentId,
      locator: { page: 2 }, excerpt,
    }],
  };
}

test("technical draft excludes unrelated pricing/forms and represents shared source passages once without losing requirement links", () => {
  const s = section();
  s.title = "Technical response";
  const linkedKeys = Array.from({ length: 12 }, (_, i) => `scope:technical-${i}`);
  s.requirementLinks.sourceRequirementKeys = linkedKeys;
  const proof = "The basket shall be furnished assembled and include an approved test weight. ".repeat(5).trim();
  s.instructions = linkedKeys.map(() => "Provide assembled basket and tested weight.").join("\n") +
    "\nPage limit: 5 pages.";
  const requirements: SolicitationRequirementSet = {
    ...source(),
    requirements: [
      ...linkedKeys.map((key, i) => fixtureRequirement(
        key, "scope", proof, `segment-${i % 2}`,
      )),
      fixtureRequirement("pricing:unrelated", "pricing", "Unit pricing is submitted in separate worksheet.", "price-segment"),
      fixtureRequirement("submission:unrelated", "form", "Sign the separate official signature page.", "form-segment"),
      fixtureRequirement("disqualifier:unrelated", "disqualifier", "Multiple bids for a line item are disallowed.", "rule-segment"),
      fixtureRequirement("insurance:unrelated", "insurance", "Attach separate insurance certificate.", "insurance-segment"),
      fixtureRequirement("certification:unrelated", "certification", null, "missing-segment"),
    ],
  };
  const result = prepareBidDraftInput({ snapshot: snapshot(), section: s, requirements, company: null });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  const body = result.packet.sourceEvidence;
  const sourceData = JSON.parse(body) as {
    documents: Array<{ versionId: string; checksumSha256: string; filename: string }>;
    passages: Array<{ id: string; documentVersionId: string; segmentId: string; excerpt: string; locator: { page: number } }>;
    requirements: Array<{ key: string; evidenceIds: string[]; text: string }>;
  };
  assert.deepEqual(sourceData.requirements.map((r) => r.key), linkedKeys);
  assert.equal(sourceData.passages.length, 2, "shared verbatim passage is sent once per pinned document/segment");
  assert.ok(sourceData.passages.every((passage) => passage.excerpt === proof));
  assert.ok(sourceData.passages.every((passage) =>
    passage.documentVersionId === versionId && passage.locator.page === 2 && passage.segmentId));
  assert.ok(sourceData.documents.some((document) =>
    document.versionId === versionId && document.checksumSha256 === "a".repeat(64)));
  assert.ok(sourceData.requirements.every((r) => r.evidenceIds.length === 1 &&
    sourceData.passages.some((passage) => passage.id === r.evidenceIds[0])));
  assert.deepEqual(result.packet.requirementKeys, linkedKeys);
  assert.doesNotMatch(body, /pricing:unrelated|submission:unrelated|disqualifier:unrelated|insurance:unrelated|certification:unrelated/);
  assert.doesNotMatch(result.packet.sectionInstructions, /Provide assembled basket and tested weight/);
  assert.match(result.packet.sectionInstructions, /Page limit: 5 pages/);
  const oldReferences = requirements.requirements.filter((r) =>
    linkedKeys.includes(r.requirementKey)).map((r) => ({
    key: r.requirementKey, text: r.text, references: r.evidence.map((e) => ({
      documentVersionId: e.opportunityDocumentVersionId,
      snapshotDocumentId: snapshot().documents[0]!.id,
      filename: snapshot().documents[0]!.filename,
      checksumSha256: snapshot().documents[0]!.checksumSha256,
      locator: e.locator, segmentId: e.documentExtractionSegmentId, excerpt: e.excerpt,
    })),
  }));
  const oldChars = JSON.stringify(oldReferences).length;
  assert.ok(body.length < oldChars * 0.7,
    `expected >30% smaller evidence packet than repeated verified refs; old=${oldChars}, new=${body.length}`);
  assert.equal(result.packet.inputFingerprint.length, 64);
  assert.deepEqual(prepareBidDraftInput({ snapshot: snapshot(), section: s, requirements, company: null }), result);
});

test("explicit cross-section applicability requires pinned evidence and remains separate from citation-eligible section keys", () => {
  const requirements: SolicitationRequirementSet = {
    ...source(), requirements: [
      ...source().requirements,
      fixtureRequirement("rule:all", "disqualifier", "Do not include alternate contract terms.", "terms-segment", {
        appliesToAllResponseSections: true,
      }),
      fixtureRequirement("rule:other", "disqualifier", "Other section only.", "other-segment", {
        appliesToResponseSections: ["Technical response"],
      }),
      fixtureRequirement("rule:unrelated", "disqualifier", "Sign the original form.", "signature-segment"),
    ],
  };
  const result = prepareBidDraftInput({ snapshot: snapshot(), section: section(), requirements, company: null });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.match(result.packet.sourceEvidence, /rule:all/);
  assert.doesNotMatch(result.packet.sourceEvidence, /rule:other|rule:unrelated/);
  assert.deepEqual(result.packet.requirementKeys, ["pricing:1"],
    "cross-cutting source rules must not become unsupported section-citation keys");
});

test("missing or changed pinned evidence in linked section remains blocked rather than silently narrowed", () => {
  const s = section();
  const r = source();
  r.requirements[0]!.evidence[0]!.excerpt = "   ";
  const result = prepareBidDraftInput({ snapshot: snapshot(), section: s, requirements: r, company: null });
  assert.equal(result.state, "blocked");
  if (result.state === "blocked") assert.match(result.reasons.join(" "), /readable source excerpt/i);
});


test("mixed listing and document-backed sections use distinct source citations without fabricating a document version", () => {
  const s=section(), r=source();
  r.requirements.push({
    id:"r2",requirementKey:"quantity:listing",type:"quantity",level:"required",
    text:"Provide 10 annual licenses.",sourceSection:"quantities",sourceFindingKey:"listing-quantity",
    details:{sourceSegmentIds:[]},evidence:[],
    listingEvidence:{
      sourceRecordId:"source-record-id",payloadHash:"b".repeat(64),sourceRevisionId:"rev-1",
      field:"description",excerpt:"City of Houston requires 10 annual licenses.",
    },
  });
  s.requirementLinks.sourceRequirementKeys = [
    ...(s.requirementLinks.sourceRequirementKeys as string[]), "quantity:listing",
  ];
  const result=prepareBidDraftInput({snapshot:snapshot(),section:s,requirements:r,company:null});
  assert.equal(result.state,"ready");
  if(result.state!=="ready")return;
  const body=JSON.parse(result.packet.sourceEvidence) as {
    passages:Array<{documentVersionId:string}>,
    listingPassages:Array<{sourceRecordId:string;payloadHash:string;field:string;excerpt:string}>,
    requirements:Array<{key:string;evidenceIds:string[]}>,
  };
  assert.equal(body.listingPassages.length,1);
  assert.equal(body.listingPassages[0]?.sourceRecordId,"source-record-id");
  assert.equal(body.listingPassages[0]?.payloadHash,"b".repeat(64));
  assert.equal(body.listingPassages[0]?.field,"description");
  assert.equal(body.passages.length,1);
  assert.deepEqual(body.requirements.map((x)=>x.key),["pricing:1","quantity:listing"]);
  assert.equal(body.requirements[1]?.evidenceIds.length,1);
  assert.notEqual(body.requirements[0]?.evidenceIds[0],body.requirements[1]?.evidenceIds[0]);
  const changed=structuredClone(r);
  changed.requirements[1]!.listingEvidence=null;
  assert.equal(prepareBidDraftInput({snapshot:snapshot(),section:s,requirements:changed,company:null}).state,"blocked");
  const incomplete=structuredClone(r);
  incomplete.completenessStatus="partial";
  assert.equal(prepareBidDraftInput({snapshot:snapshot(),section:s,requirements:incomplete,company:null}).state,"blocked");
});

test("reconciled but human-edited response remains blocked until the user reviews its preserved wording",()=>{
  const s=section();
  s.metadata.sourceReviewRequired=true;
  s.content="Previously saved response must be checked against newly amended documents.";
  const result=prepareBidDraftInput({
    snapshot:snapshot(),section:s,requirements:source(),company:null,
  });
  assert.equal(result.state,"blocked");
  if (result.state==="blocked") assert.match(result.reasons.join(" "),/review.*preserved|preserved.*review/i);
});
