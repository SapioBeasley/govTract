import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { generateBidSectionDraft, listBidDraftGenerations } from "@/lib/bids/draft-persistence";
import { updateBidOutlineSection } from "@/lib/bids/outline-persistence";
import type { BidDraftModelProvider } from "@/lib/bids/draft-provider";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("manual draft requests are audited, duplicate clicks do not bill twice, edits survive and amendments block model calls", { skip: !process.env.DATABASE_URL }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceId: string | null = null;
  const suffix = randomUUID();
  let modelCalls = 0;
  const provider: BidDraftModelProvider = {
    profile: {
      id: "fixture-v1", provider: "mock", model: "fixture-model", billingMode: "non_billable",
      inputTokenLimit: 100_000, outputTokenLimit: 2048,
      inputCostMicrousdPerMillionTokens: 0, outputCostMicrousdPerMillionTokens: 0,
    },
    modelVersion: "fixture-1",
    async generate() {
      modelCalls++;
      return {
        output: { content: "Draft based on a verified solicitation excerpt.",
          requirementKeys: ["price-1"], missingFacts: ["Confirm final pricing"] },
        modelVersion: "fixture-1",
        usage: { promptTokenCount: 120, candidatesTokenCount: 80, thoughtsTokenCount: 0, totalTokenCount: 200 },
      };
    },
  };
  try {
    const [record] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('bid-draft-test', ${suffix}, '{}'::jsonb, ${hash(suffix)}) RETURNING id
    `;
    sourceId = record!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${sourceId}, 'bid-draft-test', ${suffix}, 'Bid drafting fixture') RETURNING id
    `;
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity!.id}, 'Pricing', 'Pricing.xlsx', 'application/vnd.ms-excel') RETURNING id
    `;
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name
      ) VALUES (${document!.id}, 1, ${hash(suffix + "-version")}, ${hash(suffix + "-bytes")}, 'Pricing.xlsx') RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Bid drafting fixture') RETURNING id
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
      summary: "Fill agency pricing form.", scope: [], deliverables: [], workBreakdown: [],
      location: [], schedule: [], quantities: [], qualifications: [], insuranceBonding: [],
      mandatoryEvents: [], pricingInstructions: [], submissionComponents: [], evaluationCriteria: [],
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
        ${opportunity!.id}, ${understanding!.id}, 'price-1', 'pricing', 'required',
        'Complete the original pricing worksheet.', 'pricingInstructions', 'price-finding'
      )
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence (
        solicitation_understanding_id, finding_key, opportunity_document_version_id,
        locator, excerpt
      ) VALUES (
        ${understanding!.id}, 'price-finding', ${version!.id},
        ${sql.json({ sheet: "Rates" })}, 'Enter bid price only in Rates worksheet'
      )
    `;
    const populated = await getBidWorkspace(workspace!.id);
    assert.equal(populated?.sourceSnapshot.snapshotStatus, "complete");
    const [section] = await sql<{ id: string }[]>`
      INSERT INTO bid_sections (
        bid_workspace_id, title, instructions, requirement_links, metadata
      ) VALUES (
        ${workspace!.id}, 'Pricing', 'Complete original worksheet',
        ${sql.json({ sourceRequirementKeys: ["price-1"] })},
        ${sql.json({
          understandingId: understanding!.id, pursuitSnapshotId: pinned.id,
          documentSetFingerprint: pinned.documentSetFingerprint,
        })}
      ) RETURNING id
    `;
    const requestId = randomUUID();
    const first = await generateBidSectionDraft({
      workspaceId: workspace!.id, sectionId: section!.id, requestId,
      replace: false, provider,
    });
    assert.equal(first.state, "completed");
    assert.equal(first.applied, true);
    assert.equal(modelCalls, 1);
    assert.match(first.content ?? "", /\[NEEDS INPUT: Confirm final pricing\]/);
    const original = await listBidDraftGenerations(workspace!.id);
    assert.equal(original.length, 1);
    assert.equal(original[0]?.modelName, "fixture-model");
    assert.equal(original[0]?.documentVersions[0]?.versionId, version!.id);
    assert.equal(original[0]?.inputTokenCount, 120);
    assert.equal(original[0]?.applied, true);
    await assert.rejects(
      () => generateBidSectionDraft({ workspaceId: workspace!.id, sectionId: section!.id,
        requestId, replace: true, provider }), /already (?:processed|requested)/i,
    );
    assert.equal(modelCalls, 1);
    await updateBidOutlineSection(workspace!.id, section!.id, { content: "My own revised bid." });
    await assert.rejects(
      () => generateBidSectionDraft({ workspaceId: workspace!.id, sectionId: section!.id,
        requestId: randomUUID(), replace: false, provider }), /explicit replacement/i,
    );
    const second = await generateBidSectionDraft({ workspaceId: workspace!.id,
      sectionId: section!.id, requestId: randomUUID(), replace: true, provider });
    assert.equal(second.state, "completed");
    assert.equal(modelCalls, 2);
    assert.equal((await listBidDraftGenerations(workspace!.id)).length, 2);

    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name, is_amendment
      ) VALUES (
        ${document!.id}, 2, ${hash(suffix + "-amended")}, ${hash(suffix + "-new-bytes")}, 'Addendum Pricing.xlsx', true
      )
    `;
    await assert.rejects(
      () => generateBidSectionDraft({ workspaceId: workspace!.id, sectionId: section!.id,
        requestId: randomUUID(), replace: true, provider }), /changed|stale|snapshot|current/i,
    );
    assert.equal(modelCalls, 2, "amendment cannot invoke another model call");
    assert.equal((await listBidDraftGenerations(workspace!.id)).length, 2);
  } finally {
    await closeDb();
    if (sourceId) await sql`DELETE FROM source_records WHERE id = ${sourceId}`;
    await sql.end({ timeout: 5 });
  }
});
