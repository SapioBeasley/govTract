export type BidderInputAnswer = {
  question: string;
  answer: string;
};

export type BidderAnswerReplacement = {
  question: string;
  text: string;
};

const needsInputPattern = /\[NEEDS\s+INPUT:\s*([^\]]+?)\s*\]/gi;
const vendorSubject = /\b(?:we|our(?: company| team| proposed| offered| products?| equipment)?|the bidder|each (?:basket|unit|product)|(?:the|our) (?:offered |proposed )?(?:basket|unit|product|equipment|model)|manufacturer)\b/i;
const commitment = /\b(?:will|shall|can|are|is|has|have|meet(?:s)?|comply|complies|provide(?:s)?|supply|deliver(?:s)?|carry|carries|include(?:s)?|offer(?:s|ed)?|propose(?:s|d)?|certif(?:ied|y)|test(?:ed|ing)?|insur(?:ed|ance)|warrant(?:y|ies)?)\b/i;
const claim = /\b(?:compliance|comply|compliant|requirements?|standards?|safety|certif(?:ied|ication|y)|approved|test(?:ed|ing|s)?|warrant(?:y|ies)|guarantee|insur(?:ance|ed)|liability|coverage|bond(?:ing|ed)?|deliver(?:y|ed|ies)?|logistics|transport|ship(?:ping|ped)?|provide|supply|offer(?:ed)?|manufactur(?:er|e|ed)|assembled?|equipment|product|basket|capacity|rated load|available|pric(?:e|ing)|rates?|cost|quote)\b/i;

function normalizedQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function extractNeedsInputPrompts(content: string): string[] {
  const prompts: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(needsInputPattern)) {
    const question = normalizedQuestion(match[1] ?? "");
    if (!question) continue;
    const key = question.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    prompts.push(question);
  }
  return prompts;
}

export function normalizeBidderInputAnswers(
  content: string,
  values: BidderInputAnswer[],
): BidderInputAnswer[] {
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error("Bidder answers must be a list of at most 50 items.");
  }
  const allowed = new Map(extractNeedsInputPrompts(content).map((question) => [
    question.toLocaleLowerCase("en-US"),
    question,
  ]));
  const result: BidderInputAnswer[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value.question !== "string" || typeof value.answer !== "string") {
      throw new Error("Each bidder answer requires a question and answer.");
    }
    const question = normalizedQuestion(value.question);
    const key = question.toLocaleLowerCase("en-US");
    const canonical = allowed.get(key);
    if (!canonical) {
      throw new Error("Each bidder answer must correspond to an unresolved Needs-input prompt.");
    }
    if (seen.has(key)) throw new Error("Each Needs-input prompt can be answered only once per request.");
    seen.add(key);
    const answer = value.answer.trim();
    if (!answer) continue;
    if (answer.length > 2_000) throw new Error("Bidder answers cannot exceed 2,000 characters each.");
    result.push({ question: canonical, answer });
  }
  return result;
}

function stripAuthorizedAnswer(text: string, answer: string) {
  return text
    .split(answer).join(" ")
    .replace(/\b(?:our|the bidder(?:'s)?)\s+(?:response|commitment|answer)\s+(?:is|will be)\s*:?/gi, " ")
    .replace(/\b(?:bidder response|response)\s*:?/gi, " ")
    .replace(/[\s:,-]+/g, " ")
    .trim();
}

export function applyBidderAnswerReplacements(input: {
  content: string;
  answers: BidderInputAnswer[];
  replacements: BidderAnswerReplacement[];
  sourceEvidence: string;
}): string {
  const answers = normalizeBidderInputAnswers(input.content, input.answers);
  if (!answers.length) throw new Error("At least one Needs-input answer is required.");
  if (!Array.isArray(input.replacements) || input.replacements.length !== answers.length) {
    throw new Error("AI answer revision must return exactly one replacement per supplied answer.");
  }
  const answerMap = new Map(answers.map((item) => [
    item.question.toLocaleLowerCase("en-US"),
    item,
  ]));
  const replacementMap = new Map<string, string>();
  for (const replacement of input.replacements) {
    if (!replacement || typeof replacement.question !== "string" || typeof replacement.text !== "string") {
      throw new Error("AI answer revision returned an invalid replacement.");
    }
    const question = normalizedQuestion(replacement.question);
    const key = question.toLocaleLowerCase("en-US");
    const answer = answerMap.get(key);
    if (!answer || replacementMap.has(key)) {
      throw new Error("AI answer revision returned an unsupported or duplicate question.");
    }
    const text = replacement.text.trim();
    if (!text || text.length > 4_000) throw new Error("AI answer revision returned invalid replacement text.");
    if (!text.includes(answer.answer)) {
      throw new Error("AI answer revision must retain the supplied bidder answer verbatim.");
    }
    if (/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]/i.test(text)) {
      throw new Error("AI answer revision cannot replace an answered gap with another placeholder.");
    }
    const connective = stripAuthorizedAnswer(text, answer.answer);
    if (connective && vendorSubject.test(connective) && commitment.test(connective) && claim.test(connective)) {
      throw new Error("AI answer revision added an unsupported bidder claim beyond the supplied answer.");
    }
    replacementMap.set(key, text);
  }

  let replaced = 0;
  const revised = input.content.replace(needsInputPattern, (whole, rawQuestion: string) => {
    const key = normalizedQuestion(rawQuestion).toLocaleLowerCase("en-US");
    const replacement = replacementMap.get(key);
    if (!replacement) return whole;
    replaced++;
    return replacement;
  });
  if (replaced < replacementMap.size) {
    throw new Error("One or more answered Needs-input prompts could not be located in the current bid.");
  }
  return revised;
}
