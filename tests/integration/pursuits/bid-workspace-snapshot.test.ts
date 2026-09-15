import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { ensureBidWorkspaceSnapshotPrepared } from "@/lib/procurement/pursuits/snapshot";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("a bid workspace prepares a source snapshot and a changed document set marks the workspace stale", { skip: !canRun }, async () => {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceRecordId: string | null = null;

  try {
    const [sourceRecord] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('snapshot-workspace-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
      RETURNING id
    `;
    sourceRecordId = sourceRecord!.id;

    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (
        source_record_id, source, source_opportunity_id, title, agency_name
      ) VALUES (
        ${sourceRecord!.id}, 'snapshot-workspace-test', ${`opp-${suffix}`},
        ${`Workspace snapshot fixture ${suffix}`}, 'City of Houston'
      ) RETURNING id
    `;
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (
        opportunity_id, source_document_key, name, mime_type, source_metadata
      ) VALUES (
        ${opportunity!.id}, ${`solicitation-${suffix}.pdf`}, 'Solicitation.pdf',
        'application/pdf', '{}'::jsonb
      ) RETURNING id
    `;
    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256,
        retrieved_at, name, mime_type, is_amendment, source_metadata
      ) VALUES (
        ${document!.id}, 1, ${sha256("metadata-v1")}, ${sha256("bytes-v1")},
        now(), 'Solicitation.pdf', 'application/pdf', false, '{}'::jsonb
      )
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title, source_snapshot, metadata)
      VALUES (${opportunity!.id}, 'Bid workspace', '{}'::jsonb, '{}'::jsonb)
      RETURNING id
    `;

    const first = await ensureBidWorkspaceSnapshotPrepared(workspace!.id);
    assert.equal(first.bidWorkspaceId, workspace!.id);

    const [initialWorkspace] = await sql<{ sourceSnapshot: Record<string, unknown> }[]>`
      SELECT source_snapshot AS "sourceSnapshot"
      FROM bid_workspaces
      WHERE id = ${workspace!.id}
    `;
    assert.equal(initialWorkspace!.sourceSnapshot.pursuitSnapshotId, first.id);
    assert.equal(initialWorkspace!.sourceSnapshot.stale, false);

    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256,
        retrieved_at, name, mime_type, is_amendment, amendment_label, source_metadata
      ) VALUES (
        ${document!.id}, 2, ${sha256("metadata-v2")}, ${sha256("bytes-v2")},
        now(), 'Solicitation Addendum 1.pdf', 'application/pdf', true, 'Addendum 1', '{}'::jsonb
      )
    `;

    const second = await ensureBidWorkspaceSnapshotPrepared(workspace!.id);
    assert.notEqual(second.id, first.id);
    assert.equal(second.supersedesSnapshotId, first.id);

    const [staleWorkspace] = await sql<{ sourceSnapshot: Record<string, unknown> }[]>`
      SELECT source_snapshot AS "sourceSnapshot"
      FROM bid_workspaces
      WHERE id = ${workspace!.id}
    `;
    assert.equal(staleWorkspace!.sourceSnapshot.pursuitSnapshotId, second.id);
    assert.equal(staleWorkspace!.sourceSnapshot.stale, true);
    assert.equal(
      staleWorkspace!.sourceSnapshot.staleReason,
      "authoritative_document_set_changed",
    );
  } finally {
    if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
    await sql.end({ timeout: 5 });
    await closeDb();
  }
});
