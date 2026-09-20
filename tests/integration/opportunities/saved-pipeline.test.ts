import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  deleteSavedOpportunity,
  getSavedOpportunity,
  listSavedOpportunities,
  saveOpportunity,
  updateSavedOpportunity,
} from "@/lib/opportunities/saved";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

async function seedOpportunity() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [sourceRecord] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('saved-pipeline-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
      RETURNING id
    `;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (
        source_record_id, source, source_opportunity_id, title, agency_name, due_at
      ) VALUES (
        ${sourceRecord!.id}, 'saved-pipeline-test', ${`opp-${suffix}`},
        ${`Saved pipeline fixture ${suffix}`}, 'City of Houston', '2026-10-15T22:00:00Z'
      ) RETURNING id
    `;
    return { opportunityId: opportunity!.id, sourceRecordId: sourceRecord!.id };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanup(sourceRecordId: string) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("saving is idempotent and Saved remains lightweight", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const first = await saveOpportunity({ opportunityId: fixture.opportunityId });
    const second = await saveOpportunity({ opportunityId: fixture.opportunityId });

    assert.equal(second.id, first.id);
    assert.equal(first.status, "saved");
    assert.equal(first.priority, 0);
    assert.equal(first.internalDeadline, null);
    assert.equal(first.snapshotStatus, "not_required");

    const rows = await listSavedOpportunities({});
    assert.equal(rows.filter((row) => row.opportunityId === fixture.opportunityId).length, 1);
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});

test("pursuit lifecycle stores notes, priority, deadline, and exposes incomplete snapshot readiness", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    const updated = await updateSavedOpportunity(fixture.opportunityId, {
      status: "pursuing",
      notes: "Confirm insurance and pricing workbook.",
      priority: 5,
      internalDeadline: new Date("2026-10-10T17:00:00Z"),
    });

    assert.equal(updated.status, "pursuing");
    assert.equal(updated.snapshotStatus, "incomplete");
    assert.equal(updated.notes, "Confirm insurance and pricing workbook.");
    assert.equal(updated.priority, 5);
    assert.equal(updated.internalDeadline?.toISOString(), "2026-10-10T17:00:00.000Z");

    const pursuing = await listSavedOpportunities({ status: "pursuing" });
    assert.ok(pursuing.some((row) => row.opportunityId === fixture.opportunityId));

    const persisted = await getSavedOpportunity(fixture.opportunityId);
    assert.equal(persisted?.snapshotStatus, "incomplete");
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});

test("saved opportunities can move through terminal pursuit statuses and be removed", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await updateSavedOpportunity(fixture.opportunityId, { status: "reviewing" });
    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    await updateSavedOpportunity(fixture.opportunityId, { status: "submitted", submissionConfirmed: true });
    await updateSavedOpportunity(fixture.opportunityId, { status: "won" });

    assert.equal((await getSavedOpportunity(fixture.opportunityId))?.status, "won");

    await deleteSavedOpportunity(fixture.opportunityId);
    assert.equal(await getSavedOpportunity(fixture.opportunityId), null);
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});

test("Submitted requires explicit confirmation of actual external submission, never a ready checklist", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await assert.rejects(() => updateSavedOpportunity(fixture.opportunityId, { status: "submitted" }),
      /confirm.*external submission/i);
    assert.equal((await getSavedOpportunity(fixture.opportunityId))?.status, "saved");
    const confirmed = await updateSavedOpportunity(fixture.opportunityId, {
      status: "submitted", submissionConfirmed: true,
    });
    assert.equal(confirmed.status, "submitted");
    const notesOnly = await updateSavedOpportunity(fixture.opportunityId, {
      status: "submitted", notes: "Receipt verified at the external portal.",
    });
    assert.equal(notesOnly.status, "submitted", "editing an already submitted record is not a new submission");
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});
