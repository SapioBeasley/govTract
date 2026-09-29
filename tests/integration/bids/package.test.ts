import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { saveFullBidDraft } from "@/lib/bids/full-bid-persistence";
import {
  approveBidPackage,
  buildApprovedBidPackage,
  getBidPackageStatus,
} from "@/lib/bids/package-persistence";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("package approval is explicit, exact-version bound, downloadable, and invalidated by edits", { skip: !process.env.DATABASE_URL }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceId: string | null = null;
  const suffix = randomUUID();
  try {
    const [record] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('package-test', ${suffix}, '{}'::jsonb, ${hash(suffix)}) RETURNING id
    `;
    sourceId = record!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title, canonical_url)
      VALUES (${sourceId}, 'package-test', ${suffix}, 'Package fixture', 'https://buyer.example.test/opportunity/1')
      RETURNING id
    `;
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity!.id}, 'Scope', 'Scope.pdf', 'application/pdf') RETURNING id
    `;
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name
      ) VALUES (
        ${document!.id}, 1, ${hash(suffix + "-v1")}, ${hash(suffix + "-bytes")}, 'Scope.pdf'
      ) RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Package fixture') RETURNING id
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
      summary: "Deliver the chair.",
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
        ${opportunity!.id}, ${understanding!.id}, 'scope-deliver', 'scope', 'required',
        'Deliver the requested chair.', 'scope', 'scope-deliver'
      )
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence (
        solicitation_understanding_id, finding_key, opportunity_document_version_id, locator, excerpt
      ) VALUES (
        ${understanding!.id}, 'scope-deliver', ${version!.id},
        ${sql.json({ page: 1 })}, 'Deliver the requested chair.'
      )
    `;

    await saveFullBidDraft(workspace!.id, "Exact approved response.");
    const before = await getBidPackageStatus(workspace!.id);
    assert.equal(before.readyForApproval, true);
    assert.equal(before.approvalCurrent, false);
    assert.equal(before.submission.url, "https://buyer.example.test/opportunity/1");

    const approved = await approveBidPackage(workspace!.id);
    assert.equal(approved.approvalCurrent, true);
    assert.ok(approved.approvedAt);

    const download = await buildApprovedBidPackage(workspace!.id);
    assert.match(download.filename, /bid-package\.tar$/);
    assert.equal(download.bytes.includes(Buffer.from("Exact approved response.")), true);
    assert.equal(download.manifest.packageFingerprint, approved.packageFingerprint);
    assert.equal(download.manifest.submission.submittedByGovTract, false);

    await saveFullBidDraft(workspace!.id, "Exact approved response with a human edit.");
    const edited = await getBidPackageStatus(workspace!.id);
    assert.equal(edited.readyForApproval, true);
    assert.equal(edited.approvalCurrent, false);
    assert.notEqual(edited.packageFingerprint, approved.packageFingerprint);
    await assert.rejects(
      () => buildApprovedBidPackage(workspace!.id),
      /approve the exact saved bid/i,
    );
  } finally {
    await closeDb();
    if (sourceId) await sql`DELETE FROM source_records WHERE id = ${sourceId}`;
    await sql.end({ timeout: 5 });
  }
});
