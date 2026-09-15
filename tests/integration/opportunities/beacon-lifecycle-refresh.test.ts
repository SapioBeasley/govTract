import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { applyBeaconLifecycleObservation } from "@/lib/procurement/sources/beacon/lifecycle-persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

async function seedFixture() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [sourceRecord] = await sql<{ id: string }[]>`
      INSERT INTO source_records (
        source, source_record_id, source_agency, raw_payload, payload_hash, is_active
      ) VALUES (
        'beacon', ${`beacon-lifecycle-${suffix}`}, 'city-of-houston',
        ${sql.json({ id: `beacon-lifecycle-${suffix}`, status: "approved" })}::jsonb,
        ${`hash-${suffix}`}, true
      ) RETURNING id
    `;

    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (
        source_record_id, source, source_opportunity_id, title, status, source_status,
        agency_name, agency_slug, due_at, canonical_url, lifecycle_state, is_active
      ) VALUES (
        ${sourceRecord!.id}, 'beacon', ${`beacon-lifecycle-${suffix}`},
        ${`Lifecycle fixture ${suffix}`}, 'open', 'approved',
        'City of Houston', 'city-of-houston', '2026-09-11T17:00:00Z',
        ${`https://www.beaconbid.com/solicitations/city-of-houston/beacon-lifecycle-${suffix}`},
        'active', true
      ) RETURNING id
    `;

    await sql`
      INSERT INTO opportunity_source_records (
        opportunity_id, source_record_id, is_primary, source_authority,
        normalized_payload, evidence
      ) VALUES (
        ${opportunity!.id}, ${sourceRecord!.id}, true, 'authoritative',
        ${sql.json({
          title: `Lifecycle fixture ${suffix}`,
          status: "open",
          sourceStatus: "approved",
          agencyName: "City of Houston",
          agencySlug: "city-of-houston",
          dueAt: "2026-09-11T17:00:00.000Z",
          canonicalUrl: `https://www.beaconbid.com/solicitations/city-of-houston/beacon-lifecycle-${suffix}`,
          location: { locality: "Houston", region: "TX", country: "US" },
        })}::jsonb,
        '{}'::jsonb
      )
    `;

    return { sql, sourceRecordId: sourceRecord!.id, opportunityId: opportunity!.id };
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }
}

test("authoritative Beacon lifecycle observation updates source evidence and canonical lifecycle idempotently", { skip: !canRun }, async () => {
  const fixture = await seedFixture();
  try {
    const observedAt = new Date("2026-09-15T04:30:00Z");
    await applyBeaconLifecycleObservation({
      opportunityId: fixture.opportunityId,
      state: "pending_award",
      sourceStatus: "PENDING AWARD",
      sourceUrl: "https://www.beaconbid.com/solicitations/city-of-houston/example",
      evidenceText: "PENDING AWARD",
      observedAt,
    });
    await applyBeaconLifecycleObservation({
      opportunityId: fixture.opportunityId,
      state: "pending_award",
      sourceStatus: "PENDING AWARD",
      sourceUrl: "https://www.beaconbid.com/solicitations/city-of-houston/example",
      evidenceText: "PENDING AWARD",
      observedAt,
    });

    const [opportunity] = await fixture.sql<{
      source_status: string | null;
      lifecycle_state: string;
      is_active: boolean;
    }[]>`
      SELECT source_status, lifecycle_state, is_active
      FROM opportunities WHERE id = ${fixture.opportunityId}
    `;
    assert.equal(opportunity?.source_status, "PENDING AWARD");
    assert.equal(opportunity?.lifecycle_state, "pending_award");
    assert.equal(opportunity?.is_active, false);

    const [link] = await fixture.sql<{
      normalized_payload: Record<string, unknown>;
      evidence: Record<string, unknown>;
    }[]>`
      SELECT normalized_payload, evidence
      FROM opportunity_source_records
      WHERE opportunity_id = ${fixture.opportunityId}
    `;
    assert.equal(link?.normalized_payload.sourceStatus, "PENDING AWARD");
    assert.deepEqual(link?.evidence.lifecycleObservation, {
      state: "pending_award",
      sourceStatus: "PENDING AWARD",
      sourceUrl: "https://www.beaconbid.com/solicitations/city-of-houston/example",
      evidenceText: "PENDING AWARD",
      observedAt: "2026-09-15T04:30:00.000Z",
    });

    const [{ count }] = await fixture.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM opportunity_source_records
      WHERE opportunity_id = ${fixture.opportunityId}
    `;
    assert.equal(count, 1);
  } finally {
    await fixture.sql`DELETE FROM source_records WHERE id = ${fixture.sourceRecordId}`;
    await fixture.sql.end({ timeout: 5 });
    await closeDb();
  }
});
