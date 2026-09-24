import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { generateBidComplianceMatrix, updateBidComplianceRequirement } from "@/lib/bids/compliance-persistence";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const canRun = Boolean(process.env.DATABASE_URL);

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("compliance matrix is idempotent, preserves user progress and historical versions across an addendum", { skip: !canRun }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const suffix = `${process.pid}-${Date.now()}`;
  let sourceRecordId: string | null = null;

  try {
    const [record] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('compliance-test', ${suffix}, '{}'::jsonb, ${hash(suffix)})
      RETURNING id
    `;
    sourceRecordId = record!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title, agency_name)
      VALUES (${record!.id}, 'compliance-test', ${suffix}, 'Addendum bid fixture', 'Fixture agency')
      RETURNING id
    `;

    const versions: Record<string, string> = {};
    for (const filename of ["Solicitation.pdf", "Required Form.pdf", "Pricing.xlsx", "Addendum 1.pdf"]) {
      const [document] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
        VALUES (${opportunity!.id}, ${filename}, ${filename}, 'application/pdf')
        RETURNING id
      `;
      const [version] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type, is_amendment
        ) VALUES (
          ${document!.id}, 1, ${hash(filename)}, ${hash(`file:${filename}`)},
          ${filename}, 'application/pdf', ${filename.startsWith("Addendum")}
        ) RETURNING id
      `;
      versions[filename] = version!.id;
    }
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Fixture bid')
      RETURNING id
    `;
    const firstSnapshot = await ensureBidWorkspaceSnapshotPrepared(workspace!.id);
    assert.equal(firstSnapshot.documents.length, 4);
    await sql`
      UPDATE pursuit_snapshot_documents SET status = 'stored'
      WHERE pursuit_snapshot_id = ${firstSnapshot.id}
    `;
    await sql`
      UPDATE pursuit_document_snapshots
      SET status = 'complete', stored_document_count = 4, completed_at = now()
      WHERE id = ${firstSnapshot.id}
    `;

    const understandingContent = {
      summary: "Respond using the required form, pricing sheet and addendum.",
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
        ${opportunity!.id}, ${hash(suffix)}, '1', 'fixture', 'fixture',
        'fixture', 'automatic_initial', 'completed', 'complete', ${sql.json(understandingContent)}
      ) RETURNING id
    `;
    for (const [i, filename, type, section] of [
      [0, "Required Form.pdf", "form", "submissionComponents"],
      [1, "Pricing.xlsx", "pricing", "pricingInstructions"],
      [2, "Addendum 1.pdf", "certification", "submissionComponents"],
    ] as const) {
      const findingKey = `fixture-${i}`;
      await sql`
        INSERT INTO solicitation_requirements (
          opportunity_id, solicitation_understanding_id, requirement_key, requirement_type,
          requirement_level, text, source_section, source_finding_key
        ) VALUES (
          ${opportunity!.id}, ${understanding!.id}, ${findingKey}, ${type},
          'required', ${`Submit ${filename}`}, ${section}, ${findingKey}
        )
      `;
      await sql`
        INSERT INTO solicitation_understanding_evidence (
          solicitation_understanding_id, finding_key, opportunity_document_version_id, locator, excerpt
        ) VALUES (
          ${understanding!.id}, ${findingKey}, ${versions[filename]}, ${sql.json({ page: i + 1 })},
          ${`Submit ${filename}`}
        )
      `;
    }

    const generated = await generateBidComplianceMatrix(workspace!.id);
    assert.ok(generated);
    assert.equal(generated.requirements.length, 3);
    assert.deepEqual(generated.requirements.map((r) => r.status), ["missing", "missing", "missing"]);
    assert.equal(generated.requirements.every((r) => r.canMarkComplete), true);
    const form = generated.requirements.find((r) => r.requirementType === "form")!;
    const frozen = form.evidence;
    assert.equal((frozen.references as Array<{ opportunityDocumentVersionId: string }>)[0]?.opportunityDocumentVersionId, versions["Required Form.pdf"]);

    // The old contract allowed a source citation alone to mark Complete. It must now
    // fail closed until the bidder confirms an actual original form or saved response.
    await assert.rejects(
      () => updateBidComplianceRequirement(workspace!.id, form.id, { status: "complete" }),
      /saved bid response|original form|reviewed/i,
    );
    const formSourceId = form.sourceRequirementKey!.split(":")[1]!;
    await sql`
      UPDATE bid_workspaces SET metadata = jsonb_build_object(
        'originalFormsFingerprint', ${firstSnapshot.documentSetFingerprint}::text,
        'confirmedOriginalForms', jsonb_build_array(${formSourceId}::text)
      ) WHERE id = ${workspace!.id}
    `;
    await updateBidComplianceRequirement(workspace!.id, form.id, {
      status: "complete", responseNotes: "Finished and checked.",
      responseSelection: { kind: "original_form" }, responseReviewed: true,
    });
    const regenerated = await generateBidComplianceMatrix(workspace!.id);
    assert.equal(regenerated?.requirements.length, 3, "repeated generation must not duplicate rows");
    assert.equal(regenerated?.requirements.find((r) => r.id === form.id)?.status, "complete");
    assert.equal(regenerated?.requirements.find((r) => r.id === form.id)?.effectiveStatus, "complete");
    assert.equal(regenerated?.requirements.find((r) => r.id === form.id)?.responseNotes, "Finished and checked.");
    assert.deepEqual(regenerated?.requirements.find((r) => r.id === form.id)?.evidence, frozen);

    const pricing = regenerated!.requirements.find((r) => r.requirementType === "pricing")!;
    const [responseSection] = await sql<{ id: string }[]>`
      INSERT INTO bid_sections (bid_workspace_id, title, content, metadata)
      VALUES (${workspace!.id}, 'Pricing response', 'Our saved pricing and delivery proposal.', ${sql.json({
        pursuitSnapshotId: firstSnapshot.id, documentSetFingerprint: firstSnapshot.documentSetFingerprint,
        understandingId: understanding!.id,
      })})
      RETURNING id
    `;
    await assert.rejects(
      () => updateBidComplianceRequirement(workspace!.id, pricing.id, {
        status: "complete", responseSelection: { kind: "section", sectionId: responseSection!.id },
        responseReviewed: false,
      }),
      /explicitly confirm/i,
    );
    await updateBidComplianceRequirement(workspace!.id, pricing.id, {
      status: "complete", responseSelection: { kind: "section", sectionId: responseSection!.id },
      responseReviewed: true,
    });
    assert.equal((await getBidWorkspace(workspace!.id))!.requirements.find((r) => r.id === pricing.id)?.effectiveStatus,
      "complete", "the saved bid section is proof of bidder-side coverage");
    await sql`UPDATE bid_sections SET content = 'Edited proposal requiring fresh review' WHERE id = ${responseSection!.id}`;
    const responseEdited = (await getBidWorkspace(workspace!.id))!.requirements.find((r) => r.id === pricing.id)!;
    assert.equal(responseEdited.status, "complete", "historical bidder progress is retained");
    assert.equal(responseEdited.effectiveStatus, "needs_review", "editing the cited bid text invalidates completion");
    await assert.rejects(
      () => updateBidComplianceRequirement(workspace!.id, pricing.id, {
        status: "complete", responseReviewed: true,
      }),
      /select the saved bid response/i,
    );

    const [addendumDocument] = await sql<{ id: string }[]>`
      SELECT id FROM opportunity_documents WHERE opportunity_id = ${opportunity!.id} AND name = 'Addendum 1.pdf'
    `;
    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256,
        name, mime_type, is_amendment, amendment_label
      ) VALUES (
        ${addendumDocument!.id}, 2, ${hash("addendum-v2")}, ${hash("addendum-v2-bytes")},
        'Addendum 2.pdf', 'application/pdf', true, 'Addendum 2'
      )
    `;
    const nextSnapshot = await ensureBidWorkspaceSnapshotPrepared(workspace!.id);
    assert.notEqual(nextSnapshot.id, firstSnapshot.id);
    const staleWorkspace = await getBidWorkspace(workspace!.id);
    assert.ok(staleWorkspace?.sourceSnapshot.stale);
    const oldForm = staleWorkspace!.requirements.find((r) => r.id === form.id)!;
    assert.equal(oldForm.status, "complete", "user progress remains unchanged");
    assert.equal(oldForm.effectiveStatus, "needs_review", "changed source must not appear complete");
    assert.deepEqual(oldForm.evidence, frozen, "historical source references must not be rebound");
    await assert.rejects(
      () => updateBidComplianceRequirement(workspace!.id, form.id, { status: "complete" }),
      /Review the current solicitation/,
    );
  } finally {
    await closeDb();
    if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
    await sql.end({ timeout: 5 });
  }
});
