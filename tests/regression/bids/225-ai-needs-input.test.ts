import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  applyBidderAnswerReplacements,
  extractNeedsInputPrompts,
  normalizeBidderInputAnswers,
} from "@/lib/bids/bidder-inputs";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("needs-input prompts are deduplicated into stable answer cards", () => {
  const content = [
    "Technical response.",
    "[NEEDS INPUT: Confirm delivery schedule]",
    "Pricing response.",
    "[NEEDS INPUT: Confirm final pricing]",
    "[NEEDS INPUT:   Confirm delivery schedule   ]",
  ].join("\n");
  assert.deepEqual(extractNeedsInputPrompts(content), [
    "Confirm delivery schedule",
    "Confirm final pricing",
  ]);
});

test("bidder answers are limited to unresolved prompts and empty answers are ignored", () => {
  const content = "[NEEDS INPUT: Confirm delivery schedule]\n[NEEDS INPUT: Confirm final pricing]";
  assert.deepEqual(normalizeBidderInputAnswers(content, [
    { question: "Confirm delivery schedule", answer: "  Delivery within 21 calendar days after receipt of PO.  " },
    { question: "Confirm final pricing", answer: "   " },
  ]), [
    { question: "Confirm delivery schedule", answer: "Delivery within 21 calendar days after receipt of PO." },
  ]);
  assert.throws(() => normalizeBidderInputAnswers(content, [
    { question: "Invent a certification", answer: "Certified." },
  ]), /unresolved needs-input prompt/i);
});

test("AI answer replacements preserve unrelated draft text and must retain the user's answer verbatim", () => {
  const current = [
    "Intro remains unchanged.",
    "[NEEDS INPUT: Confirm delivery schedule]",
    "Pricing remains [NEEDS INPUT: Confirm final pricing].",
  ].join("\n");
  const answers = normalizeBidderInputAnswers(current, [
    { question: "Confirm delivery schedule", answer: "Delivery within 21 calendar days after receipt of PO." },
  ]);
  const revised = applyBidderAnswerReplacements({
    content: current,
    answers,
    replacements: [{
      question: "Confirm delivery schedule",
      text: "Our delivery commitment is: Delivery within 21 calendar days after receipt of PO.",
    }],
    sourceEvidence: "{\"requirements\":[]}",
  });
  assert.match(revised, /^Intro remains unchanged\./);
  assert.match(revised, /Our delivery commitment is: Delivery within 21 calendar days after receipt of PO\./);
  assert.match(revised, /\[NEEDS INPUT: Confirm final pricing\]/);
  assert.doesNotMatch(revised, /\[NEEDS INPUT: Confirm delivery schedule\]/);

  assert.throws(() => applyBidderAnswerReplacements({
    content: current,
    answers,
    replacements: [{
      question: "Confirm delivery schedule",
      text: "We are fully certified and will deliver quickly.",
    }],
    sourceEvidence: "{\"requirements\":[]}",
  }), /verbatim|unsupported/i);
});

test("bid UI exposes answer cards and a separate explicit manual AI update action", () => {
  const control = read("components/bid-package-control.tsx");
  assert.match(control, /Needs your input/);
  assert.match(control, /Update bid with my answers/);
  assert.match(control, /\/api\/bids\/\$\{workspaceId\}\/draft\/answers/);
  assert.match(control, /answer/i);
  assert.doesNotMatch(control, /onChange=\{[^}]*update.*answers.*fetch/i,
    "typing an answer must not invoke AI");
});

test("answer revision route and prompt keep bidder answers distinct from solicitation evidence", () => {
  const route = read("app/api/bids/[id]/draft/answers/route.ts");
  const provider = read("lib/bids/draft-provider.ts");
  assert.match(route, /applyBidderAnswersToFullBid/);
  assert.match(provider, /user-authorized bidder/i);
  assert.match(provider, /not (?:buyer|solicitation|source) evidence/i);
  assert.match(provider, /verbatim/i);
});


test("bidder-answer persistence is content-bound and fails closed on in-flight source or draft changes", () => {
  const persistence = read("lib/bids/bidder-input-persistence.ts");
  assert.match(persistence, /currentSection\?\.content === section\.content/);
  assert.match(persistence, /inputFingerprint === packet\.inputFingerprint/);
  assert.match(persistence, /IS NOT DISTINCT FROM/);
  assert.match(persistence, /source_or_section_changed/);
  assert.match(persistence, /generationTrigger:\s*"manual"/);
});
