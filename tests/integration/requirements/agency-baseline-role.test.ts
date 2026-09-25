import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { loadLatestSolicitationRequirements } from "@/lib/procurement/requirements/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("exact shared source key and checksum classify current agency boilerplate without rewriting stored requirements", { skip: !canRun }, async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const marker = `agency-baseline-${process.pid}-${Date.now()}`;
  const checksum = hash(marker + "-shared");
  const sourceIds: string[] = [];
  try {
    const opportunities: Array<{ id: string; versionId: string }> = [];
    for (let index = 0; index < 3; index += 1) {
      const [source] = await sql<{ id: string }[]>`
        INSERT INTO source_records (source, source_record_id, source_agency, raw_payload, payload_hash)
        VALUES ('fixture-baseline', ${marker + "-" + index}, 'fixture-agency', '{}'::jsonb, ${hash(marker + "-payload-" + index)})
        RETURNING id
      `;
      sourceIds.push(source.id);
      const [opportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities
          (source_record_id, source, source_opportunity_id, title, agency_name, agency_slug)
        VALUES (${source.id}, 'fixture-baseline', ${marker + "-opp-" + index},
          ${"Fixture " + index}, 'Fixture Agency', 'fixture-agency')
        RETURNING id
      `;
      const [document] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents
          (opportunity_id, source_document_key, name, mime_type)
        VALUES (${opportunity.id}, 'agency/shared/general-terms', 'General Terms.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        RETURNING id
      `;
      const [version] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions
          (opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type)
        VALUES (${document.id}, 1, ${hash(marker + "-fingerprint-" + index)}, ${checksum},
          'General Terms.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        RETURNING id
      `;
      opportunities.push({ id: opportunity.id, versionId: version.id });
    }

    const output = {
      summary: "Fixture.",
      scope: [], deliverables: [], workBreakdown: [], location: [], schedule: [], quantities: [],
      qualifications: [], insuranceBonding: [], mandatoryEvents: [],
      pricingInstructions: [{ key: "hold", text: "Hold pricing for 90 days." }],
      submissionComponents: [], evaluationCriteria: [], disqualifiers: [], questionsAmbiguities: [],
    };
    const target = opportunities[0]!;
    const [understanding] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_understandings
        (opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
         model_name, generation_trigger, status, completeness_status, structured_output)
      VALUES (${target.id}, ${hash(marker + "-run")}, '1', 'fixture', 'fixture', 'fixture',
        'manual', 'completed', 'complete', ${sql.json(output)})
      RETURNING id
    `;
    await sql`
      INSERT INTO solicitation_requirements
        (opportunity_id, solicitation_understanding_id, requirement_key, requirement_type,
         requirement_level, text, source_section, source_finding_key, details)
      VALUES (${target.id}, ${understanding.id}, 'pricingInstructions:hold', 'pricing',
        'required', 'Hold pricing for 90 days.', 'pricingInstructions', 'hold', '{}'::jsonb)
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence
        (solicitation_understanding_id, finding_key, opportunity_document_version_id, locator, excerpt)
      VALUES (${understanding.id}, 'hold', ${target.versionId}, '{}'::jsonb, 'Hold pricing for 90 days.')
    `;

    const shared = await loadLatestSolicitationRequirements(target.id);
    assert.equal(shared?.requirements[0]?.details.sourceDocumentRole, "agency_baseline");
    const [stored] = await sql<{ details: Record<string, unknown> }[]>`
      SELECT details FROM solicitation_requirements WHERE solicitation_understanding_id = ${understanding.id}
    `;
    assert.deepEqual(stored.details, {}, "classification is read-side metadata and does not rewrite AI output");

    await sql`UPDATE opportunity_document_versions
      SET checksum_sha256 = ${hash(marker + "-changed")}
      WHERE id = ${opportunities[2]!.versionId}`;
    const noLongerShared = await loadLatestSolicitationRequirements(target.id);
    assert.equal(noLongerShared?.requirements[0]?.details.sourceDocumentRole, undefined);
  } finally {
    for (const id of sourceIds) await sql`DELETE FROM source_records WHERE id = ${id}`;
    await sql.end({ timeout: 5 });
  }
});
