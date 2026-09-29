import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  getBidSupportingChecklist,
  updateBidSupportingItem,
} from "@/lib/bids/supporting-items-persistence";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("supporting checklist persists user readiness only for the exact current source version", { skip: !process.env.DATABASE_URL }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceId: string | null = null;
  const suffix = randomUUID();

  try {
    const [record] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('supporting-checklist-test', ${suffix}, '{}'::jsonb, ${hash(suffix)}) RETURNING id
    `;
    sourceId = record!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${sourceId}, 'supporting-checklist-test', ${suffix}, 'Checklist fixture') RETURNING id
    `;
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity!.id}, 'Pricing', 'Pricing Worksheet.xlsx', 'application/vnd.ms-excel')
      RETURNING id
    `;
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name
      ) VALUES (
        ${document!.id}, 1, ${hash(suffix + "-v1")}, ${hash(suffix + "-bytes")}, 'Pricing Worksheet.xlsx'
      ) RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Checklist fixture') RETURNING id
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
      summary: "Return the pricing worksheet.",
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
    const [requirement] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_requirements (
        opportunity_id, solicitation_understanding_id, requirement_key, requirement_type,
        requirement_level, text, source_section, source_finding_key, details
      ) VALUES (
        ${opportunity!.id}, ${understanding!.id}, 'pricing-sheet', 'pricing', 'required',
        'Complete and return the provided Pricing Worksheet.xlsx.',
        'pricingInstructions', 'pricing-sheet',
        ${sql.json({ templateRequired: true, templateFilename: "Pricing Worksheet.xlsx" })}
      ) RETURNING id
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence (
        solicitation_understanding_id, finding_key, opportunity_document_version_id, locator, excerpt
      ) VALUES (
        ${understanding!.id}, 'pricing-sheet', ${version!.id},
        ${sql.json({ sheet: "Bid" })}, 'Complete and return the provided Pricing Worksheet.xlsx.'
      )
    `;

    const initial = await getBidSupportingChecklist(workspace!.id);
    assert.equal(initial.items.length, 1);
    assert.equal(initial.items[0]?.id, requirement!.id);
    assert.equal(initial.items[0]?.ready, false);
    assert.equal(initial.readyForPackage, false);

    const saved = await updateBidSupportingItem(workspace!.id, requirement!.id, { ready: true });
    assert.equal(saved.items[0]?.ready, true);
    assert.equal(saved.readyForPackage, true);
    assert.equal(saved.stateCurrent, true);

    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name, is_amendment
      ) VALUES (
        ${document!.id}, 2, ${hash(suffix + "-v2")}, ${hash(suffix + "-new-bytes")},
        'Pricing Worksheet Amendment.xlsx', true
      )
    `;

    const amended = await getBidSupportingChecklist(workspace!.id);
    assert.equal(amended.stateCurrent, false);
    assert.equal(amended.items[0]?.ready, false);
    assert.equal(amended.readyForPackage, false);
  } finally {
    await closeDb();
    if (sourceId) await sql`DELETE FROM source_records WHERE id = ${sourceId}`;
    await sql.end({ timeout: 5 });
  }
});
