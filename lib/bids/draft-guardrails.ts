import { createHash } from "node:crypto";

import { hasUnsafeModelAssertion, inspectModelContent } from "@/lib/bids/model-specifications";
export { derivePinnedModelFacts } from "@/lib/bids/model-specifications";

/**
 * Deterministic, fail-closed checks for AI-authored bid prose. A sentence classifier
 * provides actionable review hints, NOT evidence that omitted claims are verified.
 * Every saved AI draft still requires explicit content-bound human verification.
 */
export function reviewDraftFingerprint(content: string, documentSetFingerprint: string | null) {
  return createHash("sha256").update(JSON.stringify([content, documentSetFingerprint])).digest("hex");
}

const claimKinds: Array<[string, RegExp]> = [
  ["compliance", /\b(?:compliance|comply|compliant|meets? (?:all |applicable )?(?:requirements?|standards?))\b/i],
  ["safety or certification", /\b(?:safety|certif(?:ied|ication|y)|standards?|approved)\b/i],
  ["testing", /\b(?:test(?:ed|ing|s)?|weight testing|inspection)\b/i],
  ["warranty", /\b(?:warrant(?:y|ies)|guarantee)\b/i],
  ["insurance", /\b(?:insur(?:ance|ed)|liability|coverage|bond(?:ing|ed)?)\b/i],
  ["delivery or logistics", /\b(?:deliver(?:y|ed|ies)?|logistics|transport|ship(?:ping|ped)?)\b/i],
  ["offered product or capacity", /\b(?:provide|supply|offer(?:ed)?|manufactur(?:er|e|ed)|assembled?|equipment|product|basket|capacity|rated load|available)\b/i],
  ["pricing", /\b(?:pric(?:e|ing)|rates?|cost|quote)\b/i],
];

const vendorSubject = /\b(?:we|our(?: company| team| proposed| offered| products?| equipment)?|each (?:basket|unit|product)|(?:the|our) (?:offered |proposed )?(?:basket|unit|product|equipment|model)|manufacturer)\b/i;
const commitment = /\b(?:will|shall|can|are|is|has|have|undergo(?:es)?|meet(?:s)?|comply|complies|provide(?:s)?|supply|deliver(?:s)?|carry|carries|include(?:s)?|offer(?:s|ed)?|propose(?:s|d)?|certif(?:ied|y)|test(?:ed|ing)?|insur(?:ed|ance)|warrant(?:y|ies)?)\b/i;
export type DraftInspection = { claims: string[]; modelIssues: string[] };

/** Inspects offered-vendor assertions separately from buyer requirements and source-model mapping. */
export function inspectBidDraft(content: string, sourceEvidence: string): DraftInspection {
  const claims: string[] = [];
  // Punctuation and paragraph boundaries delimit claims; placeholder questions after
  // an assertion cannot retroactively qualify a preceding assertion.
  for (const clause of content.split(/[.!?;\n]+/).map((part) => part.trim()).filter(Boolean)) {
    if (!vendorSubject.test(clause) || !commitment.test(clause)) continue;
    for (const [kind, pattern] of claimKinds) {
      if (pattern.test(clause)) claims.push("Verify " + kind + " before making this vendor commitment: " + clause.slice(0, 180));
    }
  }

  const modelIssues = inspectModelContent(content, sourceEvidence);
  return { claims: [...new Set(claims)], modelIssues };
}


/**
 * Never save a naked affirmative vendor assertion from the model in a user-facing
 * bid response. Preserve source-descriptive prose and punctuation while replacing
 * unverified offer sentences with category-specific, in-place questions. The raw
 * provider output is retained separately in the generation audit record.
 */
export function redactUnverifiedClaims(content: string, sourceEvidence: string): string {
  return content.split(/([.!?;\n]+)/).map((chunk, index) => {
    if (index % 2 === 1 || !chunk.trim()) return chunk;
    const claims = inspectBidDraft(chunk, sourceEvidence).claims;
    const ambiguousModel = /\band\/or\b/i.test(chunk) && /\b(?:lb|lbs|pounds|model|basket)\b/i.test(chunk);
    const wrongModel = hasUnsafeModelAssertion(chunk, sourceEvidence);
    if (!claims.length && !ambiguousModel && !wrongModel) return chunk;
    const leading = chunk.match(/^\s*/)?.[0] ?? "";
    const trailing = chunk.match(/\s*$/)?.[0] ?? "";
    if (ambiguousModel || wrongModel) {
      return leading +
        "[NEEDS INPUT: Recheck each separate requested model against pinned source evidence: state the working-load limit, separate test weight, product weight and quantity only where explicitly identified; resolve contradictory or ambiguous values and verify the exact offered configuration]" +
        trailing;
    }
    const categories = [...new Set(claims.map((claim) =>
      claim.split(" before making this vendor commitment:")[0]!.replace(/^Verify /, "")))];
    return leading + "[NEEDS INPUT: Verify " + categories.join(", ") +
      " for the actual offered product and company with supporting evidence; replace with an accurate, explicitly approved commitment or remove the claim]" + trailing;
  }).join("");
}


/**
 * Explicit approval is a user assertion, not an automated finding. Reject unresolved
 * prompts and ambiguous model ratings; other flagged vendor claims remain actionable
 * human-review questions and are never machine-certified by this function.
 */
export function validateVendorFactApproval(content: string, sourceEvidence: string): string[] {
  const issues: string[] = [];
  if (!content.trim()) issues.push("A completed response is required before verification.");
  if (/^UNVERIFIED AI WORKING DRAFT\b/i.test(content.trim())) {
    issues.push("Remove the unverified AI working-draft banner after personally validating every commitment.");
  }
  if (/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\b(?:TODO|TBD)\s*[:\-]|\{\{[^}]+\}\}|<<[^>]+>>/i.test(content)) {
    issues.push("Resolve every missing-fact placeholder before verifying vendor commitments.");
  }
  issues.push(...inspectBidDraft(content, sourceEvidence).modelIssues);
  return issues;
}
