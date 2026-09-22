import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { derivePinnedModelFacts, inspectBidDraft, redactUnverifiedClaims, validateVendorFactApproval } from "@/lib/bids/draft-guardrails";
import { finalizeBidDraft, type BidDraftPacket } from "@/lib/bids/draft-input";
import { makeBidDraftPrompt } from "@/lib/bids/draft-provider";

const fixture = JSON.parse(readFileSync("tests/fixtures/bids/182-houston-man-basket-pinned-specs.json", "utf8")) as {
  sourceEvidence: { documents: Array<{ versionId: string; filename: string }>;
    passages: Array<{ id: string; documentVersionId: string; segmentId: string; locator: { page: number }; excerpt: string }> };
  expected: Record<"one" | "two", { model: string; ratedLoadLb: number; testWeightLb: number; productWeightLb: number }>;
  correctBuyerText: string; wrongBuyerText: string;
};
const evidence = JSON.stringify(fixture.sourceEvidence);

test("actual pinned Houston excerpts keep distinct rated working load, proof-test weight and product weight per model", () => {
  const facts = derivePinnedModelFacts(evidence);
  assert.deepEqual(facts.issues, []);
  assert.deepEqual(facts.models.map((model) => ({
    persons: model.persons, model: model.modelId, ratedLoadLb: model.ratedLoadLb,
    testWeightLb: model.testWeightLb, productWeightLb: model.productWeightLb,
  })), [
    { persons: 1, ...fixture.expected.one },
    { persons: 2, ...fixture.expected.two },
  ].map(({ persons, model, ratedLoadLb, testWeightLb, productWeightLb }) => ({
    persons, model, ratedLoadLb, testWeightLb, productWeightLb,
  })));
  assert.equal(fixture.sourceEvidence.passages[0]?.locator.page, 2);
  assert.notEqual(fixture.sourceEvidence.passages[0]?.documentVersionId, fixture.sourceEvidence.passages[2]?.documentVersionId);
});

test("correct buyer-requested fields and model IDs pass while swapped or conflated weights block verification", () => {
  assert.deepEqual(inspectBidDraft(fixture.correctBuyerText, evidence).modelIssues, []);
  for (const content of [
    fixture.wrongBuyerText,
    "The requested one-person MBR301LS has 375 lb working load and 300 lb test weight; two-person MBM332LS has 750 lb working load and 600 lb test weight.",
    "The requested MBR301LS and MBM332LS have 300 lb and/or 600 lb rated loads and 375 lb and/or 750 lb test weights.",
  ]) {
    const result = inspectBidDraft(content, evidence);
    assert.ok(result.modelIssues.length > 0, content);
    assert.ok(validateVendorFactApproval(content, evidence).some((reason) => /load|weight|model|ambiguous/i.test(reason)));
  }
  assert.match(redactUnverifiedClaims(fixture.wrongBuyerText, evidence), /\[NEEDS INPUT:/i);
  assert.doesNotMatch(redactUnverifiedClaims(fixture.wrongBuyerText, evidence), /rated load 375 lb/i);
});

test("source field order and model identifiers without one-person wording do not change correct mapping", () => {
  const source = JSON.stringify({ documents: fixture.sourceEvidence.documents,
    passages: [
      { documentVersionId: fixture.sourceEvidence.documents[0]!.versionId,
        excerpt: "Model # MBR301LS; Test Weight: 375 lbs; Product Weight: 290 lbs; Working Load Limit: 300 lbs" },
      { documentVersionId: fixture.sourceEvidence.documents[1]!.versionId,
        excerpt: "Model # MBM332LS; 750 lbs test weight; 345 lbs product weight; 600 lbs working load limit" },
    ] });
  const models = derivePinnedModelFacts(source);
  assert.deepEqual(models.issues, []);
  assert.equal(models.models[0]?.ratedLoadLb, 300);
  assert.equal(models.models[0]?.testWeightLb, 375);
  assert.equal(models.models[1]?.ratedLoadLb, 600);
  assert.equal(models.models[1]?.testWeightLb, 750);
  assert.deepEqual(inspectBidDraft(
    "Requested MBR301LS: working load limit 300 lbs, test weight 375 lbs, product weight 290 lbs. " +
    "Requested MBM332LS: working load limit 600 lbs, test weight 750 lbs, product weight 345 lbs.",
    source,
  ).modelIssues, []);
});

test("untyped values and conflicting source documents require clarification rather than inferred rated loads", () => {
  const untyped = JSON.stringify({ documents: fixture.sourceEvidence.documents,
    passages: [
      { documentVersionId: fixture.sourceEvidence.documents[0]!.versionId,
        excerpt: "One-person basket Model # MBR301LS 375 lb. Test weight: 375 lb." },
      fixture.sourceEvidence.passages[2],
    ] });
  const unclear = derivePinnedModelFacts(untyped);
  assert.equal(unclear.models[0]?.ratedLoadLb, null);
  assert.ok(unclear.issues.some((issue) => /ambiguous|untyped|clarif/i.test(issue)));
  assert.ok(validateVendorFactApproval(fixture.correctBuyerText, untyped).length > 0);
  const conflicting = JSON.stringify({ documents: fixture.sourceEvidence.documents,
    passages: [...fixture.sourceEvidence.passages,
      { documentVersionId: fixture.sourceEvidence.documents[0]!.versionId,
        excerpt: "Model # MBR301LS; Working Load Limit: 400 lbs; Test Weight: 375 lbs" },
    ] });
  const mismatched = derivePinnedModelFacts(conflicting);
  assert.ok(mismatched.issues.some((issue) => /conflict.*working load/i.test(issue)));
  assert.equal(mismatched.models[0]?.ratedLoadLb, null, "disagreeing values never become authoritative");
});

test("a model without an unambiguous source model-to-version mapping cannot inherit another model's numbers", () => {
  const orphan = JSON.stringify({ documents: [{ versionId: "unknown", filename: "Specifications.pdf" }],
    passages: [{ documentVersionId: "unknown", excerpt: "Model # MIXED; 375 lb; 300 lb test weight" }] });
  const assessment = derivePinnedModelFacts(orphan);
  assert.deepEqual(assessment.models, []);
  assert.ok(assessment.issues.some((issue) => /unassigned|ambiguous|clarif/i.test(issue)));
});

test("prompt and saved draft preserve requested source weights separately and do not silently approve incorrect model prose", () => {
  const packet: BidDraftPacket = {
    sectionTitle: "Technical response", sectionInstructions: "Answer the source technical requirements.",
    snapshotId: "snapshot-182", understandingId: "understanding-182", documentSetFingerprint: "source-182",
    sourceDocumentVersions: [], requirementKeys: ["one", "two"], sourceEvidence: evidence,
    companyContext: "No verified offered product", requiredQuestions: [], inputFingerprint: "fingerprint-182",
  };
  const prompt = makeBidDraftPrompt(packet);
  assert.match(prompt, /working[- ]load/i);
  assert.match(prompt, /proof[- ]test|test weight/i);
  assert.match(prompt, /300/);
  assert.match(prompt, /375/);
  assert.match(prompt, /600/);
  assert.match(prompt, /750/);
  const draft = finalizeBidDraft(packet, { content: fixture.wrongBuyerText, requirementKeys: ["one", "two"], missingFacts: [] });
  assert.match(draft.content, /\[NEEDS INPUT:/);
  assert.doesNotMatch(draft.content, /rated load 375 lb|rated load 750 lb/i);
  assert.ok(draft.inspection.modelIssues.some((issue) => /working load|test weight/i.test(issue)));
});
