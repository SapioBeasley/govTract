export type BidderInputAnswer = {
  question: string;
  answer: string;
};

export type BidderAnswerReplacement = {
  question: string;
  text: string;
};

const needsInputPattern = /\[NEEDS\s+INPUT:\s*([^\]]+?)\s*\]/gi;
const appendixMarker = "Open factual questions — verify before submission:";
const workingDraftBanner = /^UNVERIFIED AI WORKING DRAFT[^\n]*\n\n?/i;

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

function protectedFactTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of value.matchAll(/\b\d+(?:[.,]\d+)*\b/g)) tokens.add(match[0]!.toLocaleLowerCase("en-US"));
  for (const match of value.matchAll(/\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]{3,}\b/gi)) {
    tokens.add(match[0]!.toLocaleLowerCase("en-US"));
  }
  for (const match of value.matchAll(/\$\s*\d[\d,.]*/g)) tokens.add(match[0]!.replace(/\s+/g, "").toLocaleLowerCase("en-US"));
  for (const match of value.matchAll(/https?:\/\/[^\s)]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi)) {
    tokens.add(match[0]!.toLocaleLowerCase("en-US"));
  }
  return [...tokens];
}

function assertNoInventedConcreteFacts(text: string, allowedContext: string) {
  const allowed = allowedContext.toLocaleLowerCase("en-US");
  const unsupported = protectedFactTokens(text).filter((token) => !allowed.includes(token));
  if (unsupported.length) {
    throw new Error(
      "AI answer revision added unsupported concrete factual details: " + unsupported.slice(0, 5).join(", "),
    );
  }
}

function splitAppendix(content: string) {
  const marker = "\n\n" + appendixMarker + "\n";
  const index = content.indexOf(marker);
  return index < 0
    ? { body: content, appendixLines: [] as string[] }
    : {
        body: content.slice(0, index),
        appendixLines: content.slice(index + marker.length).split("\n"),
      };
}

function questionFromLine(line: string) {
  const match = line.match(/\[NEEDS\s+INPUT:\s*([^\]]+?)\s*\]/i);
  return match ? normalizedQuestion(match[1] ?? "") : null;
}

/**
 * Applies model-written proposal prose only to explicitly answered gaps. The model may
 * paraphrase a terse answer and use source-grounded buyer context, but concrete bidder
 * facts cannot appear unless they were present in the answer/question/source packet.
 */
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
    if (/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]/i.test(text)) {
      throw new Error("AI answer revision cannot replace an answered gap with another placeholder.");
    }
    assertNoInventedConcreteFacts(
      text,
      [question, answer.answer, input.sourceEvidence].join("\n"),
    );
    replacementMap.set(key, text);
  }

  const { body, appendixLines } = splitAppendix(input.content);
  const touched = new Set<string>();
  let revisedBody = body.replace(needsInputPattern, (whole, rawQuestion: string) => {
    const key = normalizedQuestion(rawQuestion).toLocaleLowerCase("en-US");
    const replacement = replacementMap.get(key);
    if (!replacement) return whole;
    touched.add(key);
    return replacement;
  });

  const remainingAppendix = appendixLines.filter((line) => {
    const question = questionFromLine(line);
    if (!question) return Boolean(line.trim());
    const key = question.toLocaleLowerCase("en-US");
    if (!replacementMap.has(key)) return true;
    touched.add(key);
    return false;
  });

  if (touched.size < replacementMap.size) {
    throw new Error("One or more answered Needs-input prompts could not be located in the current bid.");
  }

  revisedBody = revisedBody.trim();
  let revised = remainingAppendix.length
    ? revisedBody + "\n\n" + appendixMarker + "\n" + remainingAppendix.join("\n")
    : revisedBody;
  if (!needsInputPattern.test(revised)) {
    needsInputPattern.lastIndex = 0;
    revised = revised.replace(workingDraftBanner, "").trim();
  } else {
    needsInputPattern.lastIndex = 0;
  }
  return revised;
}
