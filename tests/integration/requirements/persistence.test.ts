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
  "materializes a completed understanding idempotently, repairs derived classification, and reports missing document evidence as partial",
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
        mandatoryEvents: [
          {
            key: "event.recommended",
            text: "Attendance at the pre-bid site visit is recommended.",
          },
        ],
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
      assert.deepEqual(first, { state: "materialized", requirementCount: 2 });

      const persisted = await sql<{ id: string; requirement_key: string; requirement_level: string }[]>`
        SELECT id, requirement_key, requirement_level
        FROM solicitation_requirements
        WHERE solicitation_understanding_id = ${understanding.id}
        ORDER BY requirement_key
      `;
      assert.equal(persisted.length, 2);
      const recommended = persisted.find(
        (requirement) => requirement.requirement_key === "mandatoryEvents:event.recommended",
      );
      assert.ok(recommended);
      assert.equal(recommended.requirement_level, "optional");

      await sql`
        UPDATE solicitation_requirements
        SET requirement_level = 'required'
        WHERE id = ${recommended.id}
      `;

      const second = await materializeRequirementsForUnderstanding(understanding.id);
      assert.deepEqual(second, { state: "materialized", requirementCount: 2 });
      const [repaired] = await sql<{ id: string; requirement_level: string }[]>`
        SELECT id, requirement_level
        FROM solicitation_requirements
        WHERE id = ${recommended.id}
      `;
      assert.equal(repaired?.id, recommended.id, "rematerialization must preserve requirement identity");
      assert.equal(repaired?.requirement_level, "optional");

      const loaded = await loadLatestSolicitationRequirements(opportunity.id);
      assert.ok(loaded);
      assert.equal(loaded.completenessStatus, "partial");
      assert.equal(loaded.incompleteReasons.includes("requirement_evidence_missing"), true);
      assert.equal(loaded.requirements.length, 2);
      assert.deepEqual(loaded.requirements[0]?.evidence, []);
      assert.deepEqual(loaded.requirements[1]?.evidence, []);
    } finally {
      if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);
