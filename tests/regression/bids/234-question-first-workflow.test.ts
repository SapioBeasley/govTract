import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace is question-first and no longer collects transient answers from generated draft prose", () => {
  const control = read("components/bid-package-control.tsx");

  assert.match(control, /Generate requirement questions/i);
  assert.match(control, /Draft bid/i);
  assert.match(control, /subcontractor|manufacturer/i);
  assert.doesNotMatch(control, /setAnswers\(\{\}\)/,
    "draft generation must not clear persisted requirement responses");
  assert.doesNotMatch(control, /Update bid with my answers/i,
    "draft-derived Needs Input answers are no longer the primary workflow");
});

test("requirement responses persist independently with response-source provenance", () => {
  const schema = read("lib/db/canonical-schema.ts");
  const route = read("app/api/bids/[id]/requirements/[requirementId]/response/route.ts");

  assert.match(schema, /responseSourceType/);
  assert.match(schema, /responseSourceName/);
  assert.match(route, /responseSourceType/);
  assert.match(route, /responseSourceName/);
  assert.match(route, /responseNotes/);
});

test("drafting consumes persisted bidder or supplier responses as separate non-source context", () => {
  const draftInput = read("lib/bids/draft-input.ts");
  const provider = read("lib/bids/draft-provider.ts");
  const persistence = read("lib/bids/draft-persistence.ts");

  assert.match(draftInput, /bidderResponseContext/);
  assert.match(provider, /USER\/SUPPLIER RESPONSES/i);
  assert.match(provider, /not solicitation evidence/i);
  assert.match(persistence, /workspace\.requirements/);
});

test("question generation is deterministic and does not call the model", () => {
  const route = read("app/api/bids/[id]/questions/route.ts");
  const questions = read("lib/bids/requirement-questions.ts");

  assert.match(route, /generateBidRequirementQuestions/);
  assert.doesNotMatch(route + questions, /createGemini|generateContent|provider\.generate/i);
  assert.match(questions, /form|submission_instruction/);
});
