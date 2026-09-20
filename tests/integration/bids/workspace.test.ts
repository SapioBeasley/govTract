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
        true, 'missing', '{}'::jsonb, 1
      )
    `;
    await assert.rejects(
      () => fixture.sql`
        INSERT INTO bid_requirements (
          bid_workspace_id, source_requirement_key, requirement_type, text, is_required,
          status, evidence, sort_order
        ) VALUES (
          ${first.id}, 'qualification:obsolete-status', 'qualification',
          'Legacy status must be rejected', true, 'open', '{}'::jsonb, 2
        )
      `,
      { code: "23514" },
      "the new compliance status constraint must reject legacy open values",
    );
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
    assert.equal(loaded?.requirements[0]?.status, "missing");
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

test("final review gate rejects incomplete approval and complete status, without mutating persisted workspace", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity(true);
  try {
    const workspace = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);
    assert.equal(workspace.finalReview.readyForExternalSubmission, false);
    assert.equal(workspace.finalReview.readyForHumanReview, false);
    await assert.rejects(() => updateBidWorkspace(workspace.id, { status: "complete" }),
      /final-review blocker/);
    await assert.rejects(() => updateBidWorkspace(workspace.id, {
      reviewState: "approved", humanReviewConfirmed: true,
    }), /final-review blocker/);
    const unchanged = await getBidWorkspace(workspace.id);
    assert.equal(unchanged?.status, "draft");
    assert.equal(unchanged?.reviewState, "not_started");
    assert.equal(unchanged?.finalReviewApprovalCurrent, false);

    const updated = await updateBidWorkspace(workspace.id, {
      reviewState: "in_review", notes: "Confirm the current original source files first.",
    });
    assert.equal(updated.reviewState, "in_review");
  } finally {
    await cleanup(fixture);
  }
});

test("private source file route rejects unknown and unavailable snapshot documents without contacting Blob", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const workspace = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);
    const { GET } = await import("@/app/api/bids/[id]/source-files/[documentId]/route");
    const response = await GET(new Request("http://localhost/source-file"), {
      params: Promise.resolve({
        id: workspace.id,
        documentId: "c07306a2-51cb-4fc9-8906-3d10bff08ea3",
      }),
    });
    assert.equal(response.status, 404);
  } finally {
    await cleanup(fixture);
  }
});


test("bid workspace routes distinguish valid UUIDs from malformed ids at the HTTP boundary", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const { GET: getByOpportunity, POST: startBid } = await import(
      "@/app/api/opportunities/[id]/bid-workspace/route"
    );
    const { GET: getByWorkspace } = await import("@/app/api/bids/[id]/route");
    const opportunityRequest = new Request(
      `http://localhost/api/opportunities/${fixture.opportunityId}/bid-workspace`,
    );
    const opportunityContext = { params: Promise.resolve({ id: fixture.opportunityId }) };

    const beforeCreation = await getByOpportunity(opportunityRequest, opportunityContext);
    assert.equal(beforeCreation.status, 200, "valid opportunity UUID must not be rejected");
    assert.deepEqual(await beforeCreation.json(), { workspace: null });

    const created = await startBid(opportunityRequest, opportunityContext);
    assert.equal(created.status, 200);
    const first = (await created.json()).workspace;
    assert.equal(first.opportunityId, fixture.opportunityId);

    const repeated = await startBid(opportunityRequest, opportunityContext);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).workspace.id, first.id, "Start Bid must be idempotent");

    const byOpportunity = await getByOpportunity(opportunityRequest, opportunityContext);
    assert.equal(byOpportunity.status, 200);
    assert.equal((await byOpportunity.json()).workspace.id, first.id);

    const missingWorkspace = await getByWorkspace(
      new Request(`http://localhost/api/bids/${fixture.opportunityId}`),
      { params: Promise.resolve({ id: fixture.opportunityId }) },
    );
    assert.equal(missingWorkspace.status, 404, "a valid non-workspace UUID is not malformed");
    assert.equal((await missingWorkspace.json()).error.code, "bid_workspace_not_found");

    const byWorkspace = await getByWorkspace(
      new Request(`http://localhost/api/bids/${first.id}`),
      { params: Promise.resolve({ id: first.id }) },
    );
    assert.equal(byWorkspace.status, 200);
    assert.equal((await byWorkspace.json()).workspace.id, first.id);

    const malformedContext = { params: Promise.resolve({ id: "not-a-uuid" }) };
    const invalidGet = await getByOpportunity(opportunityRequest, malformedContext);
    assert.equal(invalidGet.status, 400);
    assert.equal((await invalidGet.json()).error.code, "invalid_bid_workspace_request");
    const invalidPost = await startBid(opportunityRequest, malformedContext);
    assert.equal(invalidPost.status, 400);
    const invalidWorkspace = await getByWorkspace(
      new Request("http://localhost/api/bids/not-a-uuid"), malformedContext,
    );
    assert.equal(invalidWorkspace.status, 400);
    assert.equal((await invalidWorkspace.json()).error.code, "invalid_bid_workspace");
  } finally {
    await cleanup(fixture);
  }
});


test("downstream bid routes honor real workspace, section, request and document UUIDs", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const workspace = await ensureBidWorkspaceForOpportunity(fixture.opportunityId);
    const sectionId = "c07306a2-51cb-4fc9-8906-3d10bff08ea3";
    const context = { params: Promise.resolve({ id: workspace.id }) };
    const sectionContext = { params: Promise.resolve({ id: workspace.id, sectionId }) };
    const request = (suffix: string, body?: string) => new Request(
      `http://localhost/api/bids/${workspace.id}/${suffix}`,
      { method: "POST", ...(body === undefined ? {} : { body }) },
    );

    const { PATCH: patchWorkspace } = await import("@/app/api/bids/[id]/route");
    const patched = await patchWorkspace(new Request(request("").url, { method: "PATCH" }), context);
    assert.equal((await patched.json()).error.message, "Request body must be valid JSON.");

    const { POST: compliance } = await import("@/app/api/bids/[id]/compliance/route");
    const matrix = await compliance(request("compliance"), context);
    assert.equal(matrix.status, 409);
    assert.match((await matrix.json()).error.message, /Structured solicitation requirements/);

    const { POST: outline } = await import("@/app/api/bids/[id]/outline/route");
    const outlined = await outline(request("outline"), context);
    assert.equal(outlined.status, 409);
    assert.match((await outlined.json()).error.message, /Structured solicitation requirements/);

    const { PUT: reorder } = await import("@/app/api/bids/[id]/outline/order/route");
    const reorderResponse = await reorder(new Request(request("outline/order").url, {
      method: "PUT", body: JSON.stringify({ sectionIds: [sectionId] }),
    }), context);
    assert.equal(reorderResponse.status, 409, "real section IDs must reach the ordering service");
    assert.match((await reorderResponse.json()).error.message, /Each bid response section/);

    const { PATCH: patchSection } = await import("@/app/api/bids/[id]/outline/[sectionId]/route");
    const edited = await patchSection(new Request(request("outline/" + sectionId).url, {
      method: "PATCH", body: JSON.stringify({ content: "test" }),
    }), sectionContext);
    assert.equal(edited.status, 404, "valid section IDs must reach the section service");

    const { PATCH: patchRequirement } = await import("@/app/api/bids/[id]/compliance/[requirementId]/route");
    const requirement = await patchRequirement(new Request(request("compliance/" + sectionId).url, {
      method: "PATCH", body: JSON.stringify({ responseNotes: "test" }),
    }), { params: Promise.resolve({ id: workspace.id, requirementId: sectionId }) });
    assert.equal(requirement.status, 404, "valid requirement IDs must reach the compliance service");

    const { GET: sourceFile } = await import("@/app/api/bids/[id]/source-files/[documentId]/route");
    const sourceResponse = await sourceFile(new Request(request("source-files/" + sectionId).url), {
      params: Promise.resolve({ id: workspace.id, documentId: sectionId }),
    });
    assert.equal(sourceResponse.status, 404);
    assert.match(await sourceResponse.text(), /Original source file is not available/);

    const { POST: draft } = await import("@/app/api/bids/[id]/outline/[sectionId]/draft/route");
    const draftResponse = await draft(request("outline/" + sectionId + "/draft", JSON.stringify({
      requestId: "b07306a2-51cb-4fc9-8906-3d10bff08ea3", replace: false,
    })), sectionContext);
    assert.equal(draftResponse.status, 404, "a valid manual request id must reach the missing-section guard");
    assert.match((await draftResponse.json()).error.message, /section was not found/);
  } finally {
    await cleanup(fixture);
  }
});
