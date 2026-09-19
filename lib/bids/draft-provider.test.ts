import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiBidDraftProvider, makeBidDraftPrompt } from "@/lib/bids/draft-provider";
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
