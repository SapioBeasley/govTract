import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiBidDraftProvider, stripInternalEvidenceTags } from "@/lib/bids/draft-provider";
import { questionForBidRequirement } from "@/lib/bids/requirement-question-rules";

test("internal evidence tags never survive into bidder-facing draft text", async () => {
  assert.equal(
    stripInternalEvidenceTags("Supply exact models. [deliverables:01] Freight included. [pricingInstructions:01]"),
    "Supply exact models. Freight included.",
  );

  const provider = createGeminiBidDraftProvider({
    apiKey: "fixture-key", model: "fixture-model", modelVersion: null,
    billingMode: "non_billable", pricingProfileVersion: "fixture",
    inputTokenLimit: 100_000, outputTokenLimit: 2048,
    inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        content: "Factory sealed. [qualifications:02] [NEEDS INPUT: confirm warranty]",
        requirementKeys: ["qualifications:02"],
        missingFacts: ["Confirm warranty [deliverables:01]"],
      }) }] } }],
    }), { status: 200 }),
  });

  const result = await provider.generate("fixture");
  assert.equal(result.output.content, "Factory sealed. [NEEDS INPUT: confirm warranty]");
  assert.deepEqual(result.output.missingFacts, ["Confirm warranty"]);
  assert.deepEqual(result.output.requirementKeys, ["qualifications:02"]);
});

test("commercial questions are specific only when the solicitation requirement supports them", () => {
  const question = (requirementType: string, text: string) =>
    questionForBidRequirement({ requirementType, text } as never);

  assert.match(question("deliverable", "Manufacturer authorized reseller letter is required."), /authorization|authorized reseller/i);
  assert.match(question("deliverable", "Provide OEM warranty and DOA replacement within 5 business days."), /warranty.*DOA|DOA.*warranty/i);
  assert.match(question("schedule", "Delivery FOB Destination within 30 days ARO; freight included."), /delivery.*freight|freight.*delivery/i);
  assert.match(question("certification", "State MWBE or HUB certification and Local Vendor Preference status."), /certification.*local-preference|local-preference.*certification/i);
  assert.doesNotMatch(
    question("deliverable", "Provide five factory-sealed printers matching the specified model."),
    /warranty|reseller|MWBE|FOB/i,
  );
});
