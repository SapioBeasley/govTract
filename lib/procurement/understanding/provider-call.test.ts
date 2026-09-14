import assert from "node:assert/strict";
import test from "node:test";

import type { UnderstandingModelProvider, UnderstandingProviderRequest } from "./provider";
import { callUnderstandingProviderWithRetry, estimateProviderRequestTokenBudgets } from "./provider-call";
import type { SolicitationUnderstandingContent } from "./types";

const content: SolicitationUnderstandingContent = {
  summary: "Fixture", scope: [], deliverables: [], workBreakdown: [], location: [], schedule: [], quantities: [], qualifications: [], insuranceBonding: [], mandatoryEvents: [], pricingInstructions: [], submissionComponents: [], evaluationCriteria: [], disqualifiers: [], questionsAmbiguities: [],
};

function fixtureProvider(generate: UnderstandingModelProvider["generate"]): UnderstandingModelProvider {
  return {
    profile: {
      id: "fixture-pricing", provider: "gemini", model: "fixture-gemini", billingMode: "billable",
      inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
      inputCostMicrousdPerMillionTokens: 300_000, outputCostMicrousdPerMillionTokens: 2_500_000,
    },
    modelVersion: "fixture-v1",
    generate,
  };
}

const request: UnderstandingProviderRequest = {
  systemInstruction: "Analyze the solicitation.",
  prompt: "A".repeat(200_000),
  maxOutputTokens: 8_192,
};

test("billing estimates are conservative without treating every UTF-8 byte as a token", () => {
  const budgets = estimateProviderRequestTokenBudgets(request);
  const bytes = Buffer.byteLength(`${request.systemInstruction}\n${request.prompt}`, "utf8");
  assert.ok(budgets.billingInputTokenEstimate < bytes);
  assert.ok(budgets.billingInputTokenEstimate >= Math.ceil(bytes / 2));
  assert.ok(budgets.contextInputTokenUpperBound >= budgets.billingInputTokenEstimate);
});

test("transient quota failures retry inside the same logical provider call", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const statuses: Array<number | null> = [];
  const provider = fixtureProvider(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Gemini generateContent failed with HTTP 429: quota exceeded. Please retry in 0.001s.");
    return {
      content,
      modelVersion: "fixture-v1",
      usage: { promptTokenCount: 50_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 0, totalTokenCount: 51_000 },
    };
  });

  const result = await callUnderstandingProviderWithRetry({
    provider,
    request,
    chunkKey: "chunk-1",
    sleep: async (ms) => { delays.push(ms); },
    onFailure: (failure) => { statuses.push(failure.httpStatus); },
  });

  assert.equal(result.attemptCount, 2);
  assert.equal(result.result.content.summary, "Fixture");
  assert.deepEqual(delays, [1]);
  assert.deepEqual(statuses, [429]);
});

test("non-retryable provider failures stop after one attempt", async () => {
  let attempts = 0;
  const provider = fixtureProvider(async () => {
    attempts += 1;
    throw new Error("Gemini generateContent failed with HTTP 400: invalid request");
  });
  await assert.rejects(callUnderstandingProviderWithRetry({ provider, request, chunkKey: "chunk-1", sleep: async () => {} }), /HTTP 400/);
  assert.equal(attempts, 1);
});
