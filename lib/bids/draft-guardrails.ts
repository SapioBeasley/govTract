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


type SavedBidderResponse = {
  requirementText: string;
  answer: string;
};

function parseSavedBidderResponses(value: string): SavedBidderResponse[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as { responses?: unknown };
    if (!Array.isArray(parsed.responses)) return [];
    return parsed.responses.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      return typeof row.requirementText === "string" && typeof row.answer === "string" &&
        row.answer.trim()
        ? [{ requirementText: row.requirementText, answer: row.answer }]
        : [];
    });
  } catch {
    return [];
  }
}

const responseStopWords = new Set([
  "that","this","with","from","will","shall","must","should","have","has","been","being",
  "into","your","their","there","where","when","what","which","provide","provided","required",
  "requirement","requirements","requested","bidder","vendor","company","including","include",
]);

function meaningfulTokens(value: string) {
  return new Set((value.toLocaleLowerCase("en-US").match(/[a-z0-9$][a-z0-9$.-]*/g) ?? [])
    .filter((token) => token.length >= 3 && !responseStopWords.has(token)));
}

function concreteTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of value.matchAll(/\$\s*\d[\d,.]*/g)) {
    tokens.add(match[0]!.replace(/[\s,]/g, "").replace(/\.0+$/, "").toLocaleLowerCase("en-US"));
  }
  for (const match of value.matchAll(/\b\d+(?:[.,]\d+)*\b/g)) {
    tokens.add(match[0]!.replace(/,/g, "").replace(/\.0+$/, "").toLocaleLowerCase("en-US"));
  }
  for (const match of value.matchAll(/\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]{3,}\b/gi)) {
    if (!/^\d/.test(match[0]!)) tokens.add(match[0]!.toLocaleLowerCase("en-US"));
  }
  return tokens;
}

function responseAuthorizesClause(clause: string, bidderResponseContext: string, sourceEvidence: string) {
  const responses = parseSavedBidderResponses(bidderResponseContext);
  if (!responses.length) return false;
  const clauseTokens = meaningfulTokens(clause);
  const clauseFacts = concreteTokens(clause);
  return responses.some((response) => {
    const answer = response.answer.trim().toLocaleLowerCase("en-US");
    if (/^(?:no|n\/a|not applicable|cannot|can't|unable)\b/.test(answer)) return false;
    const allowedFacts = concreteTokens([response.requirementText, response.answer, sourceEvidence].join("\n"));
    if ([...clauseFacts].some((fact) => !allowedFacts.has(fact))) return false;

    const requirementTokens = meaningfulTokens(response.requirementText);
    const answerTokens = meaningfulTokens(response.answer);
    const requirementOverlap = [...requirementTokens].filter((token) => clauseTokens.has(token)).length;
    const answerOverlap = [...answerTokens].filter((token) => clauseTokens.has(token)).length;
    const requirementThreshold = Math.min(2, requirementTokens.size);
    const answerThreshold = Math.min(2, answerTokens.size);

    return (requirementThreshold > 0 && requirementOverlap >= requirementThreshold) ||
      (answerThreshold > 0 && answerOverlap >= answerThreshold);
  });
}

// A period inside a numeric value such as 24.75 is content, not a sentence boundary.
function isClauseBoundary(text: string, index: number) {
  const value = text[index];
  if (value === ".") {
    const previous = index > 0 ? text[index - 1] : "";
    const next = index + 1 < text.length ? text[index + 1] : "";
    if (/\d/.test(previous) && /\d/.test(next)) return false;
    return true;
  }
  return value === "!" || value === "?" || value === ";" || value === "\n";
}

function splitClausesWithDelimiters(content: string) {
  const chunks: string[] = [];
  let start = 0;
  let index = 0;
  while (index < content.length) {
    if (!isClauseBoundary(content, index)) {
      index++;
      continue;
    }
    chunks.push(content.slice(start, index));
    let end = index + 1;
    while (end < content.length && isClauseBoundary(content, end)) end++;
    chunks.push(content.slice(index, end));
    start = end;
    index = end;
  }
  chunks.push(content.slice(start));
  return chunks;
}

/** Inspects offered-vendor assertions separately from buyer requirements and source-model mapping. */
export function inspectBidDraft(
  content: string,
  sourceEvidence: string,
  bidderResponseContext = "",
): DraftInspection {
  const claims: string[] = [];
  // Punctuation and paragraph boundaries delimit claims; placeholder questions after
  // an assertion cannot retroactively qualify a preceding assertion.
  for (const clause of splitClausesWithDelimiters(content)
    .filter((_part, index) => index % 2 === 0)
    .map((part) => part.trim()).filter(Boolean)) {
    if (!vendorSubject.test(clause) || !commitment.test(clause)) continue;
    if (responseAuthorizesClause(clause, bidderResponseContext, sourceEvidence)) continue;
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
export function redactUnverifiedClaims(
  content: string,
  sourceEvidence: string,
  bidderResponseContext = "",
): string {
  return splitClausesWithDelimiters(content).map((chunk, index) => {
    if (index % 2 === 1 || !chunk.trim()) return chunk;
    const claims = inspectBidDraft(chunk, sourceEvidence, bidderResponseContext).claims;
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
