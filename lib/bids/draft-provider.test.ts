import assert from "node:assert/strict";
import test from "node:test";

import { BidDraftProviderFailure, createGeminiBidDraftProvider, makeBidDraftPrompt } from "@/lib/bids/draft-provider";
import type { BidDraftPacket } from "@/lib/bids/draft-input";

const packet: BidDraftPacket = {
  sectionTitle: "Technical Response",
  sectionInstructions: "Limit of 5 pages",
  snapshotId: "snapshot-1", understandingId: "understanding-1",
  documentSetFingerprint: "source-fingerprint",
  sourceDocumentVersions: [{
    versionId: "version-1", snapshotDocumentId: "snapshot-document-1",
    filename: "Technical.pdf", checksumSha256: "a".repeat(64),
  }],
  requirementKeys: ["req-1"],
  sourceEvidence: "Requirement REQ-1 backed by version-1 excerpt",
  companyContext: "USER_ENTERED_UNVERIFIED",
  requiredQuestions: ["Verify applicable license"],
  inputFingerprint: "b".repeat(64),
};

test("draft prompt treats source text as untrusted and refuses unsupported company claims and pricing", () => {
  const prompt = makeBidDraftPrompt(packet);
  assert.match(prompt, /explicit.*manual|manual.*explicit/i);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /never invent/i);
  assert.match(prompt, /pricing sheets/i);
  assert.match(prompt, /\[NEEDS INPUT:/);
  assert.match(prompt, /version-1/);
  assert.match(prompt, /source-fingerprint/);
});

test("Gemini bid drafting uses isolated JSON schema, bounded tokens, and mockable fetch with usage metadata", async () => {
  let sent: Record<string, unknown> | null = null;
  const provider = createGeminiBidDraftProvider({
    apiKey: "fixture-key", model: "fixture-model", modelVersion: "configured-v1",
    billingMode: "non_billable", pricingProfileVersion: "fixture-pricing",
    inputTokenLimit: 200_000, outputTokenLimit: 2048,
    inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          content: "Draft with [NEEDS INPUT: verified license].",
          requirementKeys: ["req-1"], missingFacts: ["Verify license"],
        }) }] } }],
        modelVersion: "provider-v2",
        usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 30, totalTokenCount: 100 },
      }), { status: 200 });
    },
  });
  const result = await provider.generate(makeBidDraftPrompt(packet));
  assert.deepEqual(result.output.requirementKeys, ["req-1"]);
  assert.equal(result.modelVersion, "provider-v2");
  assert.equal(result.usage.promptTokenCount, 70);
  assert.ok(JSON.stringify(sent).includes("APPLICATION_JSON"));
  assert.ok(JSON.stringify(sent).includes("2048"));
  assert.ok(!JSON.stringify(sent).includes("solicitationUnderstandingJsonSchema"));
});

test("provider rejects malformed model output instead of silently persisting it", async () => {
  const base = {
    apiKey: "fixture-key", model: "fixture-model", modelVersion: null,
    billingMode: "non_billable" as const, pricingProfileVersion: "fixture",
    inputTokenLimit: 100_000, outputTokenLimit: 2048,
    inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
  };
  const provider = createGeminiBidDraftProvider({
    ...base, fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"content":"Hello","requirementKeys":["fake"]}' }] } }],
    }), { status: 200 }),
  });
  await assert.rejects(() => provider.generate("prompt"), /invalid bid draft/i);
});

test("Gemini draft HTTP failures have safe status-only diagnostics and do not expose provider messages", async () => {
  const provider = createGeminiBidDraftProvider({
    apiKey: "fixture-secret", model: "fixture-model", modelVersion: null,
    billingMode: "billable", pricingProfileVersion: "fixture",
    inputTokenLimit: 100_000, outputTokenLimit: 8192,
    inputCostMicrousdPerMillionTokens: 300_000, outputCostMicrousdPerMillionTokens: 2_500_000,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "Secret provider payload fixture-secret" },
    }), { status: 429 }),
  });
  await assert.rejects(() => provider.generate("prompt"), (error: unknown) => {
    assert.ok(error instanceof BidDraftProviderFailure);
    assert.equal(error.failureCode, "provider_http_429");
    assert.doesNotMatch(error.message, /fixture-secret|Secret provider payload/);
    return true;
  });
});

test("Gemini draft empty output preserves safe finish reason and usage for cost reconciliation", async () => {
  const provider = createGeminiBidDraftProvider({
    apiKey: "fixture-secret", model: "fixture-model", modelVersion: null,
    billingMode: "billable", pricingProfileVersion: "fixture",
    inputTokenLimit: 100_000, outputTokenLimit: 8192,
    inputCostMicrousdPerMillionTokens: 300_000, outputCostMicrousdPerMillionTokens: 2_500_000,
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
      usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 2048, thoughtsTokenCount: 100, totalTokenCount: 2548 },
      modelVersion: "fixture-v2",
    }), { status: 200 }),
  });
  await assert.rejects(() => provider.generate("prompt"), (error: unknown) => {
    assert.ok(error instanceof BidDraftProviderFailure);
    assert.equal(error.failureCode, "provider_no_content_max_tokens");
    assert.deepEqual(error.usage, {
      promptTokenCount: 400, candidatesTokenCount: 2048, thoughtsTokenCount: 100, totalTokenCount: 2548,
    });
    assert.equal(error.modelVersion, "fixture-v2");
    return true;
  });
});

test("Gemini draft output allowance permits substantive sections while honoring configured smaller limits", async () => {
  const limits: number[] = [];
  for (const configuredLimit of [8192, 4096]) {
    const provider = createGeminiBidDraftProvider({
      apiKey: "fixture-secret", model: "fixture-model", modelVersion: null,
      billingMode: "non_billable", pricingProfileVersion: "fixture",
      inputTokenLimit: 100_000, outputTokenLimit: configuredLimit,
      inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          generationConfig: { maxOutputTokens: number };
        };
        limits.push(body.generationConfig.maxOutputTokens);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{
          text: JSON.stringify({ content: "Draft.", requirementKeys: ["req-1"], missingFacts: [] }),
        }] } }] }), { status: 200 });
      },
    });
    await provider.generate("prompt");
  }
  assert.deepEqual(limits, [8192, 4096]);
});
