import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertExplicitManualUnderstandingEvaluation, evaluateUnderstandingCase, validateUnderstandingEvaluationCase,
  planUnderstandingEvaluation, executeUnderstandingEvaluation,
  type UnderstandingEvaluationCase,
} from "@/lib/procurement/understanding/evaluation";
import { solicitationUnderstandingSectionKeys, type SolicitationUnderstandingContent } from "@/lib/procurement/understanding/types";
import type { UnderstandingModelProvider } from "@/lib/procurement/understanding/provider";

const fixtures = JSON.parse(readFileSync("tests/fixtures/understanding/47-cross-industry-requirements.json", "utf8")) as UnderstandingEvaluationCase[];
const arrays = solicitationUnderstandingSectionKeys.filter((section) => section !== "summary");
function completeContent(caseInput: UnderstandingEvaluationCase): SolicitationUnderstandingContent {
  const content = Object.fromEntries(arrays.map((section) => [section, []])) as unknown as SolicitationUnderstandingContent;
  content.summary = "A polished overview that need not list any individual mandatory requirement.";
  for (const required of caseInput.required) {
    const sourceKey = required.origin === "metadata"
      ? "META::" + required.id : "SOURCE[" + caseInput.sourceSegmentId + "]::" + required.id;
    content[required.section].push({ key: sourceKey, text: required.acceptablePhrases[0]! });
  }
  return content;
}

test("fixture gold requirements are anchored in source or labeled metadata across three procurement kinds", () => {
  assert.deepEqual(fixtures.map((fixture) => fixture.kind), ["supply", "services", "construction"]);
  const categories = new Set(fixtures.flatMap((f) => f.required.map((g) => g.section)));
  for (const section of [
    "scope", "schedule", "mandatoryEvents", "insuranceBonding", "qualifications",
    "submissionComponents", "pricingInstructions", "evaluationCriteria", "disqualifiers",
  ]) assert.ok(categories.has(section as typeof fixtures[0]["required"][number]["section"]), section);
  fixtures.forEach(validateUnderstandingEvaluationCase);
  for (const fixture of fixtures) {
    const score = evaluateUnderstandingCase(fixture, completeContent(fixture));
    assert.equal(score.passed, true, fixture.id + " " + JSON.stringify(score));
    assert.equal(score.missing.length, 0);
    assert.equal(score.missingCitations.length, 0);
  }
});

test("a beautiful summary must not conceal an omitted mandatory requirement", () => {
  const example = fixtures[1]!;
  const content = completeContent(example);
  content.summary = "Excellent, detailed summary: " + example.required.map((g) => g.sourceQuote).join(" ");
  content.mandatoryEvents = [];
  const score = evaluateUnderstandingCase(example, content);
  assert.equal(score.passed, false);
  assert.deepEqual(score.missing, ["service-event"]);
  assert.ok(score.captured < score.total);
});

test("a fact in the wrong section, or with an invented source citation, does not count as a capture", () => {
  const example = fixtures[1]!;
  const content = completeContent(example);
  const event = content.mandatoryEvents.pop()!;
  content.summary += " " + event.text;
  content.scope.push(event);
  let score = evaluateUnderstandingCase(example, content);
  assert.deepEqual(score.missing, ["service-event"]);
  content.mandatoryEvents.push({ ...event, key: "SOURCE[invented-document]::event" });
  score = evaluateUnderstandingCase(example, content);
  assert.deepEqual(score.missing, []);
  assert.deepEqual(score.missingCitations, ["service-event"]);
  assert.equal(score.passed, false);
});

test("gold labels cannot refer to source text that is not pinned in the evaluation fixture", () => {
  const example = structuredClone(fixtures[0]!);
  example.required[0]!.sourceQuote = "invented 12345 lb rated working load";
  assert.throws(() => validateUnderstandingEvaluationCase(example), /unanchored|required source quote/i);
});

test("budget and call hard caps reject an evaluation before any model call", () => {
  const overlong = structuredClone(fixtures[1]!);
  overlong.sourceText = "x".repeat(6_001);
  assert.throws(() => planUnderstandingEvaluation([overlong], {maxCases:1,maxCostMicrousd:120_000}), /source.*limit/i);
  assert.throws(() => planUnderstandingEvaluation(fixtures, {maxCases:4,maxCostMicrousd:120_000}), /case.*cap/i);
  assert.throws(() => planUnderstandingEvaluation(fixtures, {maxCases:1,maxCostMicrousd:0}), /budget/i);
});

test("bounded evaluation uses a fake provider once per selected case, returns case-level omissions and usage, without touching production understanding state", async () => {
  let calls = 0;
  const example = fixtures[1]!;
  const provider: UnderstandingModelProvider = {
    profile: {id:"test",provider:"mock",model:"fixture-model",billingMode:"billable",
      inputTokenLimit:100_000,outputTokenLimit:8_192,
      inputCostMicrousdPerMillionTokens:300_000,outputCostMicrousdPerMillionTokens:2_500_000},
    modelVersion: "fixture-1",
    async generate(request) {
      calls++;
      assert.match(request.prompt, /SOURCE_SEGMENT:fixture-service-seg1/);
      assert.doesNotMatch(request.prompt, /GEMINI_API_KEY/);
      const result = completeContent(example);
      result.disqualifiers = []; // One essential mandatory requirement intentionally omitted.
      return {content:result,modelVersion:"fixture-1",
        usage:{promptTokenCount:500,candidatesTokenCount:220,thoughtsTokenCount:0,totalTokenCount:720}};
    },
  };
  const planned = planUnderstandingEvaluation([example], {maxCases:1,maxCostMicrousd:120_000});
  const report = await executeUnderstandingEvaluation(planned, provider);
  assert.equal(calls, 1);
  assert.equal(report.passed, false);
  assert.deepEqual(report.cases[0]?.missing, ["service-disqualifier"]);
  assert.equal(report.calls, 1);
  assert.ok(report.estimatedCostMicrousd > 0);
  assert.ok(report.actualCostMicrousd > 0);
  assert.equal(report.model, "fixture-model");
  assert.equal(report.promptVersion.length > 0, true);
  assert.equal(JSON.stringify(report).includes(example.sourceText), false, "do not write raw excerpts into evaluation artifacts");
});

test("insufficient billable preflight budget blocks model use even after case selection", async () => {
  let calls = 0;
  const provider: UnderstandingModelProvider = {
    profile:{id:"expensive",provider:"mock",model:"mock",billingMode:"billable",
      inputTokenLimit:100_000,outputTokenLimit:8_192,
      inputCostMicrousdPerMillionTokens:1_000_000_000,outputCostMicrousdPerMillionTokens:1_000_000_000},
    modelVersion:null,
    async generate() {calls++; throw new Error("should not call");},
  };
  const planned = planUnderstandingEvaluation([fixtures[0]!], {maxCases:1,maxCostMicrousd:1_000});
  await assert.rejects(executeUnderstandingEvaluation(planned,provider),/budget|cap/i);
  assert.equal(calls,0);
});

test("keyword gold matching uses complete token sequences, never a substring of another requirement", () => {
  const example = fixtures[1]!;
  const content = completeContent(example);
  content.submissionComponents.find((f) => f.key.includes("service-form"))!.text = "form and materials";
  content.insuranceBonding.find((f) => f.key.includes("service-bond"))!.text = "bid bonding capacity";
  const score = evaluateUnderstandingCase(example, content);
  assert.deepEqual(score.missing, ["service-bond", "service-form"]);
});

test("paid evaluation entrypoint cannot be reached by PR CI, push, scheduled jobs or an unlabeled call", () => {
  for (const event of ["pull_request", "push", "schedule", "workflow_dispatch"]) {
    assert.throws(() => assertExplicitManualUnderstandingEvaluation({
      GITHUB_EVENT_NAME:event,GOVTRACT_EVAL_EXPLICIT_MANUAL:event === "workflow_dispatch" ? "false" : "true",
    }), /manual workflow_dispatch/i);
  }
  assert.doesNotThrow(() => assertExplicitManualUnderstandingEvaluation({
    GITHUB_EVENT_NAME:"workflow_dispatch",GOVTRACT_EVAL_EXPLICIT_MANUAL:"true",
  }));
  const workflow = readFileSync(".github/workflows/understanding-evaluation.yml", "utf8");
  assert.match(workflow,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow,/^  (?:pull_request|push|schedule):/m);
});
