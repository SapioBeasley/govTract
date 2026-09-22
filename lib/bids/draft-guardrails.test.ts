import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { inspectBidDraft, reviewDraftFingerprint, validateVendorFactApproval, redactUnverifiedClaims } from "@/lib/bids/draft-guardrails";

const fixture = JSON.parse(readFileSync("tests/fixtures/bids/180-unverified-technical-draft.json", "utf8")) as {
  content: string;
  sourceEvidence: { passages: Array<{ id: string; excerpt: string }> };
};

test("captured model-output regression flags distinct unverified vendor commitments and mixed models", () => {
  const assessment = inspectBidDraft(fixture.content, JSON.stringify(fixture.sourceEvidence));
  assert.ok(assessment.claims.length >= 4, "a trailing missing-fact question must not qualify earlier commitments");
  assert.ok(assessment.claims.some((claim) => /compliance/i.test(claim)));
  assert.ok(assessment.claims.some((claim) => /testing/i.test(claim)));
  assert.ok(assessment.claims.some((claim) => /warranty/i.test(claim)));
  assert.ok(assessment.claims.some((claim) => /insurance/i.test(claim)));
  assert.ok(assessment.modelIssues.some((issue) => /one.person|1.person/i.test(issue)));
  assert.ok(assessment.modelIssues.some((issue) => /two.person|2.person/i.test(issue)));
  assert.ok(assessment.modelIssues.some((issue) => /and\/or|ambiguous/i.test(issue)));
});

test("buyer requirements are not treated as verified company claims and correct source model pairs remain distinct", () => {
  const output = "The solicitation calls for a one-person basket with a 300 lb working load limit and a separate 375 lb test weight, and a two-person basket with a 600 lb working load limit and a separate 750 lb test weight. [NEEDS INPUT: identify and verify the actual offered models and their rated capacity.]";
  const assessment = inspectBidDraft(output, JSON.stringify(fixture.sourceEvidence));
  assert.deepEqual(assessment.claims, []);
  assert.deepEqual(assessment.modelIssues, []);
});

test("conflicting source model ratings across pinned documents require explicit clarification", () => {
  const evidence = { passages: [
    { excerpt: "One-person basket working load limit 300 lb; two-person basket working load limit 600 lb." },
    { excerpt: "One-person basket working load limit 400 lb; two-person basket working load limit 600 lb." },
  ] };
  const assessment = inspectBidDraft("The solicitation requests the one-person and two-person baskets.", JSON.stringify(evidence));
  assert.ok(assessment.modelIssues.some((issue) => /conflict|clarif/i.test(issue)));
});

test("human approval is bound to the exact reviewed text and authoritative document set", () => {
  const initial = reviewDraftFingerprint("Offered model confirmed.", "source-A");
  assert.notEqual(initial, reviewDraftFingerprint("Offered model changed.", "source-A"));
  assert.notEqual(initial, reviewDraftFingerprint("Offered model confirmed.", "source-B"));
});


test("verification requires removing placeholders and resolving ambiguous model commitments", () => {
  const open = validateVendorFactApproval(fixture.content + "\n[NEEDS INPUT: manufacturer]", JSON.stringify(fixture.sourceEvidence));
  assert.ok(open.some((reason) => /placeholder/i.test(reason)));
  assert.ok(open.some((reason) => /model|rating/i.test(reason)));
  const resolved = validateVendorFactApproval(
    "The solicitation requires a one-person basket with working load limit 300 lb and separate test weight 375 lb; the two-person basket has working load limit 600 lb and separate test weight 750 lb. We will supply the separately identified approved equipment.",
    JSON.stringify(fixture.sourceEvidence),
  );
  assert.deepEqual(resolved, [], "positive commitments may be approved only by an explicit user action, never the classifier");
});


test("distinct model quantities, rated loads and proof-test weights are not interchangeable", () => {
  const evidence = { passages: [
    { excerpt: "One-person basket: quantity 2; rated load 375 lb; test weight 1,500 lb." },
    { excerpt: "Two-person basket: quantity 1; rated load 750 lb; test weight 3,000 lb." },
  ] };
  const mixed = inspectBidDraft(
    "The one-person basket has rated load 375 lb, test weight 3,000 lb, quantity 2; the two-person basket has rated load 750 lb, test weight 1,500 lb, quantity 1.",
    JSON.stringify(evidence),
  );
  assert.ok(mixed.modelIssues.some((issue) => /test weight/i.test(issue)));
  const precise = inspectBidDraft(
    "The requested one-person basket has quantity 2, rated load 375 lb and test weight 1,500 lb. The requested two-person basket has quantity 1, rated load 750 lb and test weight 3,000 lb.",
    JSON.stringify(evidence),
  );
  assert.deepEqual(precise.modelIssues, []);
});


test("unverified working-draft warning cannot remain in an approved outward-facing response", () => {
  const source = JSON.stringify(fixture.sourceEvidence);
  assert.ok(validateVendorFactApproval(
    "UNVERIFIED AI WORKING DRAFT — check every offered claim. The solicitation requests one-person 300 lb working load and two-person 600 lb working load baskets, with separate 375 lb and 750 lb test weights.",
    source,
  ).some((reason) => /working draft|unverified/i.test(reason)));
});


test("unsafe saved-model prose becomes scoped placeholders, never a naked affirmative commitment", () => {
  const redacted = redactUnverifiedClaims(fixture.content, JSON.stringify(fixture.sourceEvidence));
  for (const unsupported of [
    /in full compliance/i, /we will provide baskets/i, /each basket undergoes/i,
    /three-year warranty/i, /product liability insurance coverage/i, /375 lb and\/or 750 lb/i,
  ]) assert.doesNotMatch(redacted, unsupported);
  assert.match(redacted, /\[NEEDS INPUT: Verify compliance/i);
  assert.match(redacted, /\[NEEDS INPUT: Verify .*warranty/i);
  assert.match(redacted, /separate.*model/i);
  assert.equal(fixture.content.includes("in full compliance"), true, "unmodified source fixture remains available to audit");
});
