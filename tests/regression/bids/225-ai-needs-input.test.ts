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

test("AI answer replacements turn terse bidder inputs into proposal-ready prose while leaving unanswered gaps", () => {
  const current = [
    "UNVERIFIED AI WORKING DRAFT — solicitation requirements are not evidence of offered-product compliance. Verify every company commitment before using this text.",
    "",
    "Delivery: [NEEDS INPUT: Confirm delivery schedule]",
    "Pricing: [NEEDS INPUT: Confirm final pricing]",
    "",
    "Open factual questions — verify before submission:",
    "- [NEEDS INPUT: Confirm delivery schedule]",
    "- [NEEDS INPUT: Confirm final pricing]",
  ].join("\n");
  const answers = normalizeBidderInputAnswers(current, [
    { question: "Confirm delivery schedule", answer: "Meets expectations" },
  ]);
  const revised = applyBidderAnswerReplacements({
    content: current,
    answers,
    replacements: [{
      question: "Confirm delivery schedule",
      text: "We will meet the delivery requirements stated in the solicitation.",
    }],
    sourceEvidence: JSON.stringify({
      requirements: [{ key: "delivery:1", text: "Deliver to the City's stated destination." }],
    }),
  });
  assert.match(revised, /We will meet the delivery requirements stated in the solicitation\./);
  assert.doesNotMatch(revised, /Delivery:\s*(?:Meets expectations|We will)/i,
    "the affected generated line should be rewritten as proposal prose, not receive an inline paste");
  assert.match(revised, /\[NEEDS INPUT: Confirm final pricing\]/);
  assert.doesNotMatch(revised, /\[NEEDS INPUT: Confirm delivery schedule\]/);
  assert.match(revised, /UNVERIFIED AI WORKING DRAFT/i,
    "working-draft warning remains while any Needs input item is unresolved");
  assert.doesNotMatch(revised, /Open factual questions[\s\S]*Confirm delivery schedule/i);

  const completed = applyBidderAnswerReplacements({
    content: "[NEEDS INPUT: Confirm delivery schedule]",
    answers,
    replacements: [{
      question: "Confirm delivery schedule",
      text: "We will meet the delivery requirements stated in the solicitation.",
    }],
    sourceEvidence: JSON.stringify({
      requirements: [{ key: "delivery:1", text: "Deliver to the City's stated destination." }],
    }),
  });
  assert.doesNotMatch(completed, /UNVERIFIED AI WORKING DRAFT|Open factual questions|NEEDS INPUT/i);
});

test("AI answer replacement rejects newly invented concrete bidder facts not present in the answer or source context", () => {
  const current = "[NEEDS INPUT: Confirm delivery schedule]";
  const answers = normalizeBidderInputAnswers(current, [
    { question: "Confirm delivery schedule", answer: "Meets expectations" },
  ]);
  assert.throws(() => applyBidderAnswerReplacements({
    content: current,
    answers,
    replacements: [{
      question: "Confirm delivery schedule",
      text: "We will deliver within 10 days under ISO 9001 certification.",
    }],
    sourceEvidence: JSON.stringify({
      requirements: [{ key: "delivery:1", text: "Deliver to the City's stated destination." }],
    }),
  }), /unsupported|invented|factual/i);
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
  assert.match(provider, /proposal-ready|complete professional/i);
  assert.match(provider, /terse|short confirmation/i);
});


test("bidder-answer persistence is content-bound and fails closed on in-flight source or draft changes", () => {
  const persistence = read("lib/bids/bidder-input-persistence.ts");
  assert.match(persistence, /currentSection\?\.content === section\.content/);
  assert.match(persistence, /inputFingerprint === packet\.inputFingerprint/);
  assert.match(persistence, /IS NOT DISTINCT FROM/);
  assert.match(persistence, /source_or_section_changed/);
  assert.match(persistence, /generationTrigger:\s*"manual"/);
});
