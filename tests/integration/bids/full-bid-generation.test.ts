import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  generateFullBidDraft,
  getFullBidArtifact,
  saveFullBidDraft,
} from "@/lib/bids/full-bid-persistence";
import { type BidDraftModelProvider } from "@/lib/bids/draft-provider";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("full bid generation is one explicit audited action with cost and source guards", { skip: !process.env.DATABASE_URL }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceId: string | null = null;
  const suffix = randomUUID();
  let modelCalls = 0;
  let capturedPrompt = "";
  const provider: BidDraftModelProvider = {
    profile: {
      id: "fixture-v1", provider: "mock", model: "fixture-model", billingMode: "non_billable",
      inputTokenLimit: 200_000, outputTokenLimit: 8192,
      inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
    },
    modelVersion: "fixture-1",
    async generate(prompt) {
      modelCalls++;
      capturedPrompt = prompt;
      return {
        output: {
          content: "We will deliver the requested chair.",
          requirementKeys: ["scope-1"],
          missingFacts: ["Identify offered manufacturer and model."],
        },
        modelVersion: "fixture-1",
        usage: {
          promptTokenCount: 150, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 250,
        },
      };
    },
  };

  try {
    const [record] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('full-bid-test', ${suffix}, '{}'::jsonb, ${hash(suffix)}) RETURNING id
    `;
    sourceId = record!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${sourceId}, 'full-bid-test', ${suffix}, 'Full bid fixture') RETURNING id
    `;
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity!.id}, 'Scope', 'Scope.pdf', 'application/pdf') RETURNING id
    `;
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name
      ) VALUES (
        ${document!.id}, 1, ${hash(suffix + "-version")}, ${hash(suffix + "-bytes")}, 'Scope.pdf'
      ) RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Full bid fixture') RETURNING id
    `;
    const pinned = await ensureBidWorkspaceSnapshotPrepared(workspace!.id);
    await sql`
      UPDATE pursuit_snapshot_documents SET status = 'stored' WHERE pursuit_snapshot_id = ${pinned.id}
    `;
    await sql`
      UPDATE pursuit_document_snapshots SET status = 'complete', stored_document_count = 1,
        completed_at = now() WHERE id = ${pinned.id}
    `;
    const structured = {
      summary: "Deliver requested chair.",
      scope: [], deliverables: [], workBreakdown: [], location: [], schedule: [],
      quantities: [], qualifications: [], insuranceBonding: [], mandatoryEvents: [],
      pricingInstructions: [], submissionComponents: [], evaluationCriteria: [],
      disqualifiers: [], questionsAmbiguities: [],
    };
    const [understanding] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_understandings (
        opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
        model_name, generation_trigger, status, completeness_status, structured_output
      ) VALUES (
        ${opportunity!.id}, ${hash(suffix)}, '1', 'fixture', 'fixture', 'fixture',
        'automatic_initial', 'completed', 'complete', ${sql.json(structured)}
      ) RETURNING id
    `;
    await sql`
      INSERT INTO solicitation_requirements (
        opportunity_id, solicitation_understanding_id, requirement_key, requirement_type,
        requirement_level, text, source_section, source_finding_key
      ) VALUES (
        ${opportunity!.id}, ${understanding!.id}, 'scope-1', 'scope', 'required',
        'Deliver the requested chair.', 'scope', 'scope-finding'
      )
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence (
        solicitation_understanding_id, finding_key, opportunity_document_version_id,
        locator, excerpt
      ) VALUES (
        ${understanding!.id}, 'scope-finding', ${version!.id},
        ${sql.json({ page: 1 })}, 'Contractor shall deliver the requested chair.'
      )
    `;

    const before = await getFullBidArtifact(workspace!.id);
    assert.equal(before?.content ?? null, null);
    assert.equal(modelCalls, 0, "loading the artifact must never invoke AI");

    const requestId = randomUUID();
    const first = await generateFullBidDraft({
      workspaceId: workspace!.id, requestId, replace: false, provider,
    });
    assert.equal(first.applied, true);
    assert.equal(modelCalls, 1);
    assert.match(first.content, /Needs your input/i);
    assert.match(first.content, /Identify offered manufacturer and model/i);
    assert.match(capturedPrompt, /complete editable bid response/i);

    await assert.rejects(
      () => generateFullBidDraft({ workspaceId: workspace!.id, requestId, replace: true, provider }),
      /already processed|already requested/i,
    );
    assert.equal(modelCalls, 1);

    await saveFullBidDraft(workspace!.id, "Human edited full bid response.");
    assert.equal((await getFullBidArtifact(workspace!.id))?.content, "Human edited full bid response.");
    assert.equal(modelCalls, 1, "ordinary saves must not invoke AI");

    await assert.rejects(
      () => generateFullBidDraft({
        workspaceId: workspace!.id, requestId: randomUUID(), replace: false, provider,
      }),
      /explicit replacement/i,
    );
    assert.equal(modelCalls, 1);

    const billable: BidDraftModelProvider = {
      ...provider,
      profile: {
        ...provider.profile, billingMode: "billable",
        inputCostMicrousdPerMillionTokens: 1_000_000, outputCostMicrousdPerMillionTokens: 1_000_000,
      },
    };
    await assert.rejects(
      () => generateFullBidDraft({
        workspaceId: workspace!.id, requestId: randomUUID(), replace: true, provider: billable,
        env: { GOVTRACT_AI_BID_DRAFT_BUDGET_USD: "0" },
      }),
      /budget is disabled|budget.*too low/i,
    );
    assert.equal(modelCalls, 1, "budget rejection must happen before the provider call");

    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name, is_amendment
      ) VALUES (
        ${document!.id}, 2, ${hash(suffix + "-amended")}, ${hash(suffix + "-new-bytes")},
        'Scope Amendment.pdf', true
      )
    `;
    await assert.rejects(
      () => generateFullBidDraft({
        workspaceId: workspace!.id, requestId: randomUUID(), replace: true, provider,
      }),
      /changed|stale|current source|amendment/i,
    );
    assert.equal(modelCalls, 1, "source changes must block before another model call");
  } finally {
    await closeDb();
    if (sourceId) await sql`DELETE FROM source_records WHERE id = ${sourceId}`;
    await sql.end({ timeout: 5 });
  }
});
