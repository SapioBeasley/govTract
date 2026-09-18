import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import type { OpportunityEvaluationResult } from "@/lib/opportunities/evaluation/rules";
import {
  getOpportunityDecision,
  loadLatestOpportunityEvaluation,
  persistOpportunityEvaluation,
  recordOpportunityDecision,
} from "@/lib/opportunities/evaluation/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

async function seed() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [source] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('evaluation-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
      RETURNING id
    `;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (
        source_record_id, source, source_opportunity_id, title, due_at
      ) VALUES (
        ${source!.id}, 'evaluation-test', ${`opp-${suffix}`},
        ${`Evaluation fixture ${suffix}`}, '2026-10-15T22:00:00Z'
      ) RETURNING id
    `;
    const [profile] = await sql<{ id: string }[]>`
      INSERT INTO company_profiles (name, is_default)
      VALUES (${`Evaluation profile ${suffix}`}, true)
      RETURNING id
    `;
    return { sourceRecordId: source!.id, opportunityId: opportunity!.id, companyProfileId: profile!.id };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanup(fixture: Awaited<ReturnType<typeof seed>>) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE id = ${fixture.sourceRecordId}`;
    await sql`DELETE FROM company_profiles WHERE id = ${fixture.companyProfileId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("unchanged evaluation inputs persist idempotently and decision stays separate", { skip: !canRun }, async () => {
  const fixture = await seed();
  try {
    const result: OpportunityEvaluationResult = {
      ruleVersion: "go-no-go-v1",
      inputFingerprint: "fingerprint-1",
      assessment: "conditional" as const,
      factors: [
        {
          key: "required-cert",
          kind: "qualification" as const,
          status: "unknown" as const,
          requirementLevel: "required" as const,
          summary: "Required certification is not confirmed by the company profile.",
          requirementKey: "qualification:sbe",
          evidence: [],
        },
      ],
    };

    const first = await persistOpportunityEvaluation({
      opportunityId: fixture.opportunityId,
      companyProfileId: fixture.companyProfileId,
      solicitationUnderstandingId: null,
      result,
    });
    const second = await persistOpportunityEvaluation({
      opportunityId: fixture.opportunityId,
      companyProfileId: fixture.companyProfileId,
      solicitationUnderstandingId: null,
      result,
    });

    assert.equal(second.id, first.id);

    const decision = await recordOpportunityDecision({
      opportunityId: fixture.opportunityId,
      companyProfileId: fixture.companyProfileId,
      evaluationId: first.id,
      decision: "revisit",
    });
    assert.equal(decision.decision, "revisit");

    const loadedEvaluation = await loadLatestOpportunityEvaluation(
      fixture.opportunityId,
      fixture.companyProfileId,
    );
    const loadedDecision = await getOpportunityDecision(
      fixture.opportunityId,
      fixture.companyProfileId,
    );
    assert.equal(loadedEvaluation?.assessment, "conditional");
    assert.equal(loadedEvaluation?.id, first.id);
    assert.equal(loadedDecision?.decision, "revisit");

    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [counts] = await sql<{ evaluations: number; decisions: number }[]>`
        SELECT
          (SELECT count(*)::int FROM opportunity_evaluations
            WHERE opportunity_id = ${fixture.opportunityId}
              AND company_profile_id = ${fixture.companyProfileId}) AS evaluations,
          (SELECT count(*)::int FROM opportunity_evaluation_decisions
            WHERE opportunity_id = ${fixture.opportunityId}
              AND company_profile_id = ${fixture.companyProfileId}) AS decisions
      `;
      assert.deepEqual(counts, { evaluations: 1, decisions: 1 });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await cleanup(fixture);
  }
});
