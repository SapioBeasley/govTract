import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { deleteSavedOpportunity } from "@/lib/opportunities/saved";
import {
  ensureBidWorkspaceForOpportunity,
  getBidWorkspace,
  getBidWorkspaceForOpportunity,
  updateBidWorkspace,
} from "@/lib/bids/workspace";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

async function seedOpportunity(withDocument = false) {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  const [source] = await sql<{ id: string }[]>`
    INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
    VALUES ('bid-workspace-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
    RETURNING id
  `;
  const [opportunity] = await sql<{ id: string }[]>`
    INSERT INTO opportunities (
      source_record_id, source, source_opportunity_id, title, agency_name, due_at
    ) VALUES (
      ${source!.id}, 'bid-workspace-test', ${`opp-${suffix}`},
      ${`Bid workspace fixture ${suffix}`}, 'City of Houston',
      '2026-10-15T22:00:00Z'
    ) RETURNING id
  `;

  let documentId: string | null = null;
  if (withDocument) {
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (
        opportunity_id, source_document_key, name, mime_type, source_metadata
      ) VALUES (
        ${opportunity!.id}, ${`solicitation-${suffix}.pdf`}, 'Solicitation.pdf',
        'application/pdf', '{}'::jsonb
      ) RETURNING id
    `;
    documentId = document!.id;
    await sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256,
        retrieved_at, name, mime_type, is_amendment, source_metadata
      ) VALUES (
        ${documentId}, 1, ${"a".repeat(64)}, ${"b".repeat(64)},
        now(), 'Solicitation.pdf', 'application/pdf', false, '{}'::jsonb
      )
    `;
  }

  return {
    sql,
    sourceRecordId: source!.id,
    opportunityId: opportunity!.id,
    documentId,
  };
}

async function cleanup(fixture: Awaited<ReturnType<typeof seedOpportunity>>) {
  await fixture.sql`DELETE FROM source_records WHERE id = ${fixture.sourceRecordId}`;
  await fixture.sql.end({ timeout: 5 });
  await closeDb();
}

test("workspace creation is idempotent, enters pursuit, and loads without regenerating content", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const first = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);
    const second = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);

    assert.equal(second.id, first.id);
    assert.equal(first.status, "draft");
    assert.equal(first.reviewState, "not_started");

    const [counts] = await fixture.sql<{
      workspaces: number;
      totalSnapshots: number;
      pursuitSnapshots: number;
      workspaceSnapshots: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM bid_workspaces
          WHERE opportunity_id = ${fixture.opportunityId}) AS workspaces,
        (SELECT count(*)::int FROM pursuit_document_snapshots
          WHERE opportunity_id = ${fixture.opportunityId}) AS "totalSnapshots",
        (SELECT count(*)::int FROM pursuit_document_snapshots
          WHERE opportunity_id = ${fixture.opportunityId}
            AND saved_opportunity_id IS NOT NULL) AS "pursuitSnapshots",
        (SELECT count(*)::int FROM pursuit_document_snapshots
          WHERE bid_workspace_id = ${first.id}) AS "workspaceSnapshots"
    `;
    assert.deepEqual(counts, {
      workspaces: 1,
      totalSnapshots: 1,
      pursuitSnapshots: 1,
      workspaceSnapshots: 1,
    });

    const [linkedSnapshot] = await fixture.sql<{ id: string }[]>`
      SELECT id
      FROM pursuit_document_snapshots
      WHERE opportunity_id = ${fixture.opportunityId}
        AND saved_opportunity_id IS NOT NULL
      LIMIT 1
    `;
    assert.equal(first.sourceSnapshot.pursuitSnapshotId, linkedSnapshot?.id);

    const [saved] = await fixture.sql<{ status: string }[]>`
      SELECT status FROM saved_opportunities
      WHERE opportunity_id = ${fixture.opportunityId} AND company_profile_id IS NULL
    `;
    assert.equal(saved?.status, "pursuing");

    await fixture.sql`
      INSERT INTO bid_requirements (
        bid_workspace_id, source_requirement_key, requirement_type, text, is_required,
        status, evidence, sort_order
      ) VALUES (
        ${first.id}, 'qualification:sbe', 'qualification', 'Provide SBE certification',
        true, 'open', '{}'::jsonb, 1
      )
    `;
    await fixture.sql`
      INSERT INTO bid_sections (
        bid_workspace_id, title, instructions, content, status, requirement_links,
        sort_order, metadata
      ) VALUES (
        ${first.id}, 'Technical Approach', 'Address the scope.', null, 'draft',
        '{}'::jsonb, 1, '{}'::jsonb
      )
    `;

    const updated = await updateBidWorkspace(first.id, {
      status: "in_progress",
      reviewState: "in_review",
      notes: "Confirm pricing form before drafting.",
    });
    assert.equal(updated.status, "in_progress");
    assert.equal(updated.reviewState, "in_review");
    assert.equal(updated.notes, "Confirm pricing form before drafting.");

    const beforeLoad = await fixture.sql<{ snapshots: number; requirements: number; sections: number }[]>`
      SELECT
        (SELECT count(*)::int FROM pursuit_document_snapshots
          WHERE opportunity_id = ${fixture.opportunityId}) AS snapshots,
        (SELECT count(*)::int FROM bid_requirements
          WHERE bid_workspace_id = ${first.id}) AS requirements,
        (SELECT count(*)::int FROM bid_sections
          WHERE bid_workspace_id = ${first.id}) AS sections
    `;

    const loaded = await getBidWorkspace(first.id);
    const loadedAgain = await getBidWorkspace(first.id);
    assert.equal(loaded?.id, first.id);
    assert.equal(loadedAgain?.id, first.id);
    assert.equal(loaded?.requirements.length, 1);
    assert.equal(loaded?.sections.length, 1);

    const afterLoad = await fixture.sql<{ snapshots: number; requirements: number; sections: number }[]>`
      SELECT
        (SELECT count(*)::int FROM pursuit_document_snapshots
          WHERE opportunity_id = ${fixture.opportunityId}) AS snapshots,
        (SELECT count(*)::int FROM bid_requirements
          WHERE bid_workspace_id = ${first.id}) AS requirements,
        (SELECT count(*)::int FROM bid_sections
          WHERE bid_workspace_id = ${first.id}) AS sections
    `;
    assert.deepEqual(afterLoad, beforeLoad, "loading a workspace must not regenerate stored content");

    const byOpportunity = await getBidWorkspaceForOpportunity(fixture.opportunityId);
    assert.equal(byOpportunity?.id, first.id);

    await assert.rejects(
      () => deleteSavedOpportunity(fixture.opportunityId),
      /Bid Workspace exists/,
      "removing Saved must not cascade the immutable snapshot under an active workspace",
    );
  } finally {
    await cleanup(fixture);
  }
});

test("workspace read model surfaces a newer authoritative document set as stale without overwriting the prior snapshot", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity(true);
  try {
    const workspace = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);
    assert.equal(workspace.sourceSnapshot.stale, false);
    const originalSnapshotId = workspace.sourceSnapshot.pursuitSnapshotId;
    assert.ok(originalSnapshotId);

    await fixture.sql`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256,
        retrieved_at, name, mime_type, is_amendment, amendment_label, source_metadata
      ) VALUES (
        ${fixture.documentId}, 2, ${"c".repeat(64)}, ${"d".repeat(64)},
        now(), 'Solicitation Addendum 1.pdf', 'application/pdf', true, 'Addendum 1',
        '{}'::jsonb
      )
    `;

    const loaded = await getBidWorkspace(workspace.id);
    assert.equal(loaded?.sourceSnapshot.stale, true);
    assert.equal(loaded?.sourceSnapshot.staleReason, "authoritative_document_set_changed");
    assert.equal(loaded?.sourceSnapshot.pursuitSnapshotId, originalSnapshotId);

    const [count] = await fixture.sql<{ snapshots: number }[]>`
      SELECT count(*)::int AS snapshots
      FROM pursuit_document_snapshots
      WHERE opportunity_id = ${fixture.opportunityId}
    `;
    assert.equal(count?.snapshots, 1, "read-only stale detection must not create a new snapshot");
  } finally {
    await cleanup(fixture);
  }
});
