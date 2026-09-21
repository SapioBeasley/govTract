import { createHash } from "node:crypto";

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
const modelLabel = /\b(?:1|one|single|2|two)[- ](?:person|man)\b/gi;
const modelWithRating = /\b(1|one|single|2|two)[- ](?:person|man)\b[^.;\r\n]{0,110}?\b(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/gi;

function modelNumber(label: string) {
  return /^(?:1|one|single)/i.test(label) ? 1 : 2;
}

function sourcePassages(sourceEvidence: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sourceEvidence);
    if (!parsed || typeof parsed !== "object" || !("passages" in parsed)) return [];
    const passages = (parsed as { passages?: unknown }).passages;
    if (!Array.isArray(passages)) return [];
    return passages.flatMap((entry) =>
      entry && typeof entry === "object" && "excerpt" in entry &&
      typeof entry.excerpt === "string" ? [entry.excerpt] : []);
  } catch {
    return [];
  }
}

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

  const ratings = new Map<number, Set<number>>();
  for (const excerpt of sourcePassages(sourceEvidence)) {
    for (const match of excerpt.matchAll(modelWithRating)) {
      const key = modelNumber(match[1]!);
      const value = Number(match[2]!.replaceAll(",", ""));
      if (!ratings.has(key)) ratings.set(key, new Set());
      ratings.get(key)!.add(value);
    }
  }
  const modelIssues: string[] = [];
  for (const [model, values] of ratings) {
    if (values.size > 1) {
      modelIssues.push("Conflicting pinned source ratings for " + model + "-person model (" + [...values].join(" / ") + " lb); clarify which document and rating applies.");
    }
  }
  if (ratings.has(1) && ratings.has(2) && ratings.get(1)!.size === 1 && ratings.get(2)!.size === 1 &&
      ratings.get(1)!.values().next().value !== ratings.get(2)!.values().next().value) {
    const references = [...content.matchAll(modelLabel)].map((match) => ({
      model: modelNumber(match[0]), start: match.index!, end: match.index! + match[0].length,
    }));
    for (const model of [1, 2]) {
      const expected = [...ratings.get(model)!][0]!;
      const corresponding = references.some((reference, index) => {
        if (reference.model !== model) return false;
        const next = references[index + 1]?.start ?? content.length;
        const fragment = content.slice(reference.end, Math.min(next, reference.end + 110));
        return new RegExp("\\b" + expected + "\\s*(?:lb|lbs|pounds)\\b", "i").test(fragment);
      });
      if (!corresponding) modelIssues.push("State the " + model + "-person model's separate " + expected + " lb requested rating and verify the offered model; do not combine ratings.");
    }
    if (/\band\/or\b/i.test(content) && /\b(?:lb|lbs|pounds|model|basket)\b/i.test(content)) {
      modelIssues.push("Ambiguous and/or model or weight option; identify each distinct model and rating.");
    }
  }
  // Pinned excerpts can carry a distinct quantity and proof-test weight in
  // addition to the rated load. Parse each named model's own excerpt span:
  // never assign a test weight from an adjacent model or call it rated capacity.
  for (const [field, sourcePattern, outputPattern, label] of [
    ["quantity", /\b(?:quantity|qty)\s*[:#]?\s*(\d+)/i,
      /\b(?:quantity|qty)\s*[:#]?\s*(\d+)/i, "quantity"],
    ["testWeight", /\b(?:test(?:ing)?|proof)(?:[\s-]+(?:weight|load))?\s*:?\s*(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/i,
      /\b(?:test(?:ing)?|proof)(?:[\s-]+(?:weight|load))?\s*:?\s*(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/i, "test weight"],
  ] as const) {
    const requested = new Map<number, Set<number>>();
    for (const excerpt of sourcePassages(sourceEvidence)) {
      const labels = [...excerpt.matchAll(modelLabel)];
      for (const [index, match] of labels.entries()) {
        const next = labels[index + 1]?.index ?? excerpt.length;
        const fragment = excerpt.slice(match.index! + match[0].length, Math.min(next, match.index! + 350));
        const value = fragment.match(sourcePattern)?.[1];
        if (!value) continue;
        const model = modelNumber(match[0]);
        if (!requested.has(model)) requested.set(model, new Set());
        requested.get(model)!.add(Number(value.replaceAll(",", "")));
      }
    }
    for (const [model, values] of requested) {
      if (values.size > 1) modelIssues.push("Conflicting pinned " + label + " for " + model + "-person model; clarify the authoritative source variant.");
    }
    if (!requested.has(1) || !requested.has(2) ||
        requested.get(1)!.size !== 1 || requested.get(2)!.size !== 1) continue;
    const references = [...content.matchAll(modelLabel)];
    for (const model of [1, 2]) {
      const expected = [...requested.get(model)!][0]!;
      const found = references.some((match, index) => {
        if (modelNumber(match[0]) !== model) return false;
        const next = references[index + 1]?.index ?? content.length;
        const fragment = content.slice(match.index! + match[0].length, Math.min(next, match.index! + 350));
        const offered = fragment.match(outputPattern)?.[1];
        return offered !== undefined && Number(offered.replaceAll(",", "")) === expected;
      });
      if (!found) modelIssues.push("State the separate " + model + "-person model " + label + " (" + expected +
        (field === "testWeight" ? " lb" : "") + ") from pinned source evidence; do not assign another model's value.");
    }
  }
  return { claims: [...new Set(claims)], modelIssues };
}


/**
 * Explicit approval is a user assertion, not an automated finding. Reject unresolved
 * prompts and ambiguous model ratings; other flagged vendor claims remain actionable
 * human-review questions and are never machine-certified by this function.
 */
export function validateVendorFactApproval(content: string, sourceEvidence: string): string[] {
  const issues: string[] = [];
  if (!content.trim()) issues.push("A completed response is required before verification.");
  if (/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\b(?:TODO|TBD)\s*[:\-]|\{\{[^}]+\}\}|<<[^>]+>>/i.test(content)) {
    issues.push("Resolve every missing-fact placeholder before verifying vendor commitments.");
  }
  issues.push(...inspectBidDraft(content, sourceEvidence).modelIssues);
  return issues;
}
