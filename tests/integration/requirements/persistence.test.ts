import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import {
  loadLatestSolicitationRequirements,
  materializeRequirementsForUnderstanding,
} from "@/lib/procurement/requirements/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function uniqueId(label: string) {
  sequence += 1;
  return `${label}-${process.pid}-${Date.now()}-${sequence}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test(
  "materializes a completed understanding idempotently and reports missing document evidence as partial",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("requirements-backfill-source");
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
        VALUES (${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Metadata-only fixture')
        RETURNING id
      `;
      assert.ok(opportunity?.id);

      const structuredOutput = {
        summary: "Submit the required response package.",
        scope: [],
        deliverables: [],
        workBreakdown: [],
        location: [],
        schedule: [],
        quantities: [],
        qualifications: [],
        insuranceBonding: [],
        mandatoryEvents: [],
        pricingInstructions: [],
        submissionComponents: [
          { key: "submission.package", text: "Submit the required response package." },
        ],
        evaluationCriteria: [],
        disqualifiers: [],
        questionsAmbiguities: [],
      };

      const [understanding] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
          model_name, generation_trigger, status, completeness_status, structured_output,
          processing_completed_at, generated_at
        ) VALUES (
          ${opportunity.id}, ${sha256(sourceOpportunityId)}, '1', 'fixture-prompt', 'fixture',
          'fixture-model', 'manual', 'completed', 'complete', ${sql.json(structuredOutput)}, now(), now()
        ) RETURNING id
      `;
      assert.ok(understanding?.id);

      const first = await materializeRequirementsForUnderstanding(understanding.id);
      assert.deepEqual(first, { state: "materialized", requirementCount: 1 });

      const [persisted] = await sql<{ id: string }[]>`
        SELECT id FROM solicitation_requirements
        WHERE solicitation_understanding_id = ${understanding.id}
      `;
      assert.ok(persisted?.id);

      const second = await materializeRequirementsForUnderstanding(understanding.id);
      assert.deepEqual(second, { state: "materialized", requirementCount: 1 });
      const [persistedAgain] = await sql<{ id: string }[]>`
        SELECT id FROM solicitation_requirements
        WHERE solicitation_understanding_id = ${understanding.id}
      `;
      assert.equal(persistedAgain?.id, persisted.id, "backfill reruns must preserve requirement identity");

      const loaded = await loadLatestSolicitationRequirements(opportunity.id);
      assert.ok(loaded);
      assert.equal(loaded.completenessStatus, "partial");
      assert.equal(loaded.incompleteReasons.includes("requirement_evidence_missing"), true);
      assert.equal(loaded.requirements.length, 1);
      assert.deepEqual(loaded.requirements[0]?.evidence, []);
    } finally {
      if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);
