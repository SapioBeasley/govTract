import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "@/app/api/opportunities/[id]/saved/route";
import { closeDb } from "@/lib/db/client";

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
      VALUES ('saved-route-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
      RETURNING id
    `;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${sourceRecord!.id}, 'saved-route-test', ${`opp-${suffix}`}, ${`Route fixture ${suffix}`})
      RETURNING id
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

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("saved opportunity API validates updates and persists pursuit readiness", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    const created = await POST(new Request("http://localhost"), context(fixture.opportunityId));
    assert.equal(created.status, 200);
    assert.equal((await created.json()).saved.status, "saved");

    const nonObject = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
      context(fixture.opportunityId),
    );
    assert.equal(nonObject.status, 400);

    const invalid = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "maybe" }),
      }),
      context(fixture.opportunityId),
    );
    assert.equal(invalid.status, 400);

    const updated = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "pursuing",
          priority: 4,
          notes: "Prepare pricing review.",
          internalDeadline: "2026-10-10T17:00:00.000Z",
        }),
      }),
      context(fixture.opportunityId),
    );
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json();
    assert.equal(updatedBody.saved.status, "pursuing");
    assert.equal(updatedBody.saved.snapshotStatus, "incomplete");
    assert.equal(updatedBody.saved.priority, 4);

    const fetched = await GET(new Request("http://localhost"), context(fixture.opportunityId));
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).saved.notes, "Prepare pricing review.");

    const removed = await DELETE(new Request("http://localhost"), context(fixture.opportunityId));
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).saved, null);
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});
