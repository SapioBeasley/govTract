import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { loadLatestCompletedSolicitationUnderstanding } from "@/lib/procurement/understanding/generation-persistence";
import type { SolicitationUnderstandingContent } from "@/lib/procurement/understanding/types";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function uniqueId(label: string) {
  sequence += 1;
  return `${label}-${process.pid}-${Date.now()}-${sequence}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const content: SolicitationUnderstandingContent = {
  summary: "Usable prior understanding.",
  scope: [],
  deliverables: [],
  workBreakdown: [{ key: "work.1", text: "Perform the stated work." }],
  location: [],
  schedule: [],
  quantities: [],
  qualifications: [],
  insuranceBonding: [],
  mandatoryEvents: [],
  pricingInstructions: [],
  submissionComponents: [],
  evaluationCriteria: [],
  disqualifiers: [],
  questionsAmbiguities: [],
};

test(
  "a failed newer regeneration does not hide the latest completed understanding",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("source");
    const sourceOpportunityId = uniqueId("opportunity");
    let sourceRecordId: string | null = null;

    try {
      const [sourceRecord] = await sql<{ id: string }[]>`
        INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
        VALUES (${source}, ${sourceOpportunityId}, '{}'::jsonb, ${sha256(sourceOpportunityId)})
        RETURNING id
      `;
      assert.ok(sourceRecord?.id);
      sourceRecordId = sourceRecord.id;

      const [opportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
        VALUES (${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Fixture opportunity')
        RETURNING id
      `;
      assert.ok(opportunity?.id);

      const [completed] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version,
          model_provider, model_name, generation_trigger, status,
          completeness_status, structured_output, processing_completed_at, generated_at
        ) VALUES (
          ${opportunity.id}, 'good-input', '1', '1', 'fixture', 'fixture-model',
          'automatic_initial', 'completed', 'complete', ${sql.json(content)}, now(), now()
        ) RETURNING id
      `;
      assert.ok(completed?.id);

      await sql`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version,
          model_provider, model_name, generation_trigger, status,
          completeness_status, failure_code, processing_completed_at, created_at
        ) VALUES (
          ${opportunity.id}, 'bad-manual-input', '1', '1', 'fixture', 'fixture-model',
          'manual', 'failed', 'partial', 'provider_failure', now(), now() + interval '1 second'
        )
      `;

      const usable = await loadLatestCompletedSolicitationUnderstanding(opportunity.id);
      assert.equal(usable?.id, completed.id);
      assert.equal(usable?.structuredOutput?.summary, content.summary);
    } finally {
      if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);
