import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function uniqueId(label: string) {
  sequence += 1;
  return `${label}-${process.pid}-${Date.now()}-${sequence}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const structuredOutput = {
  summary: "Replace the existing pump equipment and complete associated site work.",
  scope: [{ key: "scope.0", text: "Replace pump equipment." }],
  deliverables: [{ key: "deliverables.0", text: "Installed and commissioned replacement pumps." }],
  workBreakdown: [{ key: "workBreakdown.0", text: "Demolish, install, test, and commission." }],
  location: [{ key: "location.0", text: "Houston, Texas." }],
  schedule: [{ key: "schedule.0", text: "Complete within the stated contract duration." }],
  quantities: [{ key: "quantities.0", text: "Two replacement pump assemblies." }],
  qualifications: [{ key: "qualifications.0", text: "Meet the stated contractor qualification requirements." }],
  insuranceBonding: [{ key: "insuranceBonding.0", text: "Provide required insurance and bonding." }],
  mandatoryEvents: [{ key: "mandatoryEvents.0", text: "Attend the mandatory pre-bid meeting." }],
  pricingInstructions: [{ key: "pricingInstructions.0", text: "Use the agency pricing form." }],
  submissionComponents: [{ key: "submissionComponents.0", text: "Submit pricing and required certifications." }],
  evaluationCriteria: [{ key: "evaluationCriteria.0", text: "Price and responsibility are evaluated." }],
  disqualifiers: [{ key: "disqualifiers.0", text: "Late submissions are rejected." }],
  questionsAmbiguities: [{ key: "questionsAmbiguities.0", text: "Confirm shutdown sequencing." }],
};

test(
  "persists structured solicitation understanding, exact inputs, evidence, stale state, and usage metadata",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("understanding-source");
    const sourceOpportunityId = uniqueId("opportunity");
    const sourceDocumentKey = uniqueId("document");
    const checksum = sha256(sourceDocumentKey);
    const extractorName = uniqueId("extractor");
    let sourceRecordPk: string | null = null;

    try {
      const [tables] = await sql<{
        understandings: string | null;
        inputs: string | null;
        evidence: string | null;
      }[]>`
        SELECT
          to_regclass('public.solicitation_understandings')::text AS understandings,
          to_regclass('public.solicitation_understanding_inputs')::text AS inputs,
          to_regclass('public.solicitation_understanding_evidence')::text AS evidence
      `;
      assert.equal(tables?.understandings, "solicitation_understandings");
      assert.equal(tables?.inputs, "solicitation_understanding_inputs");
      assert.equal(tables?.evidence, "solicitation_understanding_evidence");

      const [sourceRecord] = await sql<{ id: string }[]>`
        INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
        VALUES (${source}, ${sourceOpportunityId}, '{}'::jsonb, ${sha256(sourceOpportunityId)})
        RETURNING id
      `;
      assert.ok(sourceRecord?.id);
      sourceRecordPk = sourceRecord.id;

      const [opportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
        VALUES (${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Understanding schema fixture')
        RETURNING id
      `;
      assert.ok(opportunity?.id);

      const [document] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (
          opportunity_id,
          source_document_key,
          name,
          mime_type
        )
        VALUES (${opportunity.id}, ${sourceDocumentKey}, 'scope.pdf', 'application/pdf')
        RETURNING id
      `;
      assert.ok(document?.id);

      const [version] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id,
          version_number,
          fingerprint,
          checksum_sha256,
          name,
          mime_type
        )
        VALUES (
          ${document.id},
          1,
          ${sha256(`${sourceDocumentKey}:v1`)},
          ${checksum},
          'scope.pdf',
          'application/pdf'
        )
        RETURNING id
      `;
      assert.ok(version?.id);

      const [extraction] = await sql<{ id: string }[]>`
        INSERT INTO document_extractions (
          checksum_sha256,
          extractor_name,
          extractor_version,
          status,
          source_mime_type,
          source_byte_count,
          extracted_char_count,
          extracted_byte_count,
          segment_count,
          completed_at
        )
        VALUES (
          ${checksum},
          ${extractorName},
          '1',
          'extracted',
          'application/pdf',
          128,
          27,
          27,
          1,
          now()
        )
        RETURNING id
      `;
      assert.ok(extraction?.id);

      const segmentContent = "Replace pump equipment.";
      const [segment] = await sql<{ id: string }[]>`
        INSERT INTO document_extraction_segments (
          document_extraction_id,
          ordinal,
          segment_type,
          locator,
          content,
          content_hash_sha256,
          char_count,
          byte_count
        )
        VALUES (
          ${extraction.id},
          0,
          'page',
          ${sql.json({ page: 1 })},
          ${segmentContent},
          ${sha256(segmentContent)},
          ${segmentContent.length},
          ${Buffer.byteLength(segmentContent, "utf8")}
        )
        RETURNING id
      `;
      assert.ok(segment?.id);

      await sql`
        INSERT INTO opportunity_document_version_extractions (
          opportunity_document_version_id,
          document_extraction_id
        )
        VALUES (${version.id}, ${extraction.id})
      `;

      const automaticFingerprint = sha256(`${opportunity.id}:${version.id}:automatic`);
      const [automatic] = await sql<{
        id: string;
        generation_trigger: string;
        status: string;
        is_stale: boolean;
      }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id,
          input_fingerprint,
          schema_version,
          prompt_version,
          model_provider,
          model_name,
          model_version,
          generation_trigger,
          status,
          structured_output,
          processing_started_at,
          processing_completed_at,
          generated_at,
          input_token_count,
          output_token_count,
          input_char_count,
          output_char_count,
          estimated_cost_microusd,
          actual_cost_microusd,
          usage_metadata
        )
        VALUES (
          ${opportunity.id},
          ${automaticFingerprint},
          '1',
          'understanding-v1',
          'fixture-provider',
          'fixture-model',
          '2026-09',
          'automatic_initial',
          'completed',
          ${sql.json(structuredOutput)},
          now(),
          now(),
          now(),
          1200,
          500,
          4800,
          2000,
          5000,
          4500,
          ${sql.json({ cached_input_tokens: 100 })}
        )
        RETURNING id, generation_trigger, status, is_stale
      `;
      assert.ok(automatic?.id);
      assert.equal(automatic.generation_trigger, "automatic_initial");
      assert.equal(automatic.status, "completed");
      assert.equal(automatic.is_stale, false);

      await sql`
        INSERT INTO solicitation_understanding_inputs (
          solicitation_understanding_id,
          opportunity_document_version_id,
          document_extraction_id
        )
        VALUES (${automatic.id}, ${version.id}, ${extraction.id})
      `;

      await sql`
        INSERT INTO solicitation_understanding_evidence (
          solicitation_understanding_id,
          finding_key,
          opportunity_document_version_id,
          document_extraction_segment_id,
          locator,
          excerpt
        )
        VALUES (
          ${automatic.id},
          'scope.0',
          ${version.id},
          ${segment.id},
          ${sql.json({ page: 1 })},
          ${segmentContent}
        )
      `;

      const [loaded] = await sql<{
        summary: string;
        scope_key: string;
        input_version_id: string;
        evidence_segment_id: string | null;
        finding_key: string;
        page: string;
      }[]>`
        SELECT
          su.structured_output ->> 'summary' AS summary,
          su.structured_output #>> '{scope,0,key}' AS scope_key,
          sui.opportunity_document_version_id AS input_version_id,
          sue.document_extraction_segment_id AS evidence_segment_id,
          sue.finding_key,
          sue.locator ->> 'page' AS page
        FROM solicitation_understandings su
        JOIN solicitation_understanding_inputs sui
          ON sui.solicitation_understanding_id = su.id
        JOIN solicitation_understanding_evidence sue
          ON sue.solicitation_understanding_id = su.id
        WHERE su.id = ${automatic.id}
      `;
      assert.equal(loaded?.summary, structuredOutput.summary);
      assert.equal(loaded?.scope_key, "scope.0");
      assert.equal(loaded?.input_version_id, version.id);
      assert.equal(loaded?.evidence_segment_id, segment.id);
      assert.equal(loaded?.finding_key, "scope.0");
      assert.equal(loaded?.page, "1");

      await assert.rejects(
        async () => {
          await sql`
            INSERT INTO solicitation_understandings (
              opportunity_id,
              input_fingerprint,
              schema_version,
              prompt_version,
              model_provider,
              model_name,
              generation_trigger,
              status
            )
            VALUES (
              ${opportunity.id},
              ${sha256(`${opportunity.id}:second-automatic`)},
              '1',
              'understanding-v1',
              'fixture-provider',
              'fixture-model',
              'automatic_initial',
              'pending'
            )
          `;
        },
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "23505",
      );

      const [manual] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id,
          input_fingerprint,
          schema_version,
          prompt_version,
          model_provider,
          model_name,
          generation_trigger,
          status,
          structured_output,
          processing_started_at,
          processing_completed_at,
          generated_at,
          input_token_count,
          output_token_count,
          input_char_count,
          output_char_count,
          estimated_cost_microusd,
          actual_cost_microusd
        )
        VALUES (
          ${opportunity.id},
          ${sha256(`${opportunity.id}:${version.id}:manual`)},
          '1',
          'understanding-v1',
          'fixture-provider',
          'fixture-model',
          'manual',
          'completed',
          ${sql.json(structuredOutput)},
          now(),
          now(),
          now(),
          1000,
          400,
          4000,
          1600,
          4000,
          3500
        )
        RETURNING id
      `;
      assert.ok(manual?.id);

      await sql`
        UPDATE solicitation_understandings
        SET
          is_stale = true,
          stale_at = now(),
          stale_reason = 'input_changed',
          updated_at = now()
        WHERE id = ${automatic.id}
      `;

      const states = await sql<{
        id: string;
        generation_trigger: string;
        status: string;
        is_stale: boolean;
        stale_reason: string | null;
      }[]>`
        SELECT id, generation_trigger, status, is_stale, stale_reason
        FROM solicitation_understandings
        WHERE opportunity_id = ${opportunity.id}
        ORDER BY created_at, id
      `;
      assert.equal(states.length, 2);
      const automaticState = states.find((row) => row.id === automatic.id);
      const manualState = states.find((row) => row.id === manual.id);
      assert.equal(automaticState?.status, "completed");
      assert.equal(automaticState?.is_stale, true);
      assert.equal(automaticState?.stale_reason, "input_changed");
      assert.equal(manualState?.generation_trigger, "manual");
      assert.equal(manualState?.is_stale, false);

      const [usage] = await sql<{
        run_count: number;
        input_tokens: number;
        output_tokens: number;
        estimated_cost_microusd: number;
        actual_cost_microusd: number;
      }[]>`
        SELECT
          COUNT(*)::int AS run_count,
          COALESCE(SUM(input_token_count), 0)::int AS input_tokens,
          COALESCE(SUM(output_token_count), 0)::int AS output_tokens,
          COALESCE(SUM(estimated_cost_microusd), 0)::int AS estimated_cost_microusd,
          COALESCE(SUM(actual_cost_microusd), 0)::int AS actual_cost_microusd
        FROM solicitation_understandings
        WHERE opportunity_id = ${opportunity.id}
      `;
      assert.equal(usage?.run_count, 2);
      assert.equal(usage?.input_tokens, 2200);
      assert.equal(usage?.output_tokens, 900);
      assert.equal(usage?.estimated_cost_microusd, 9000);
      assert.equal(usage?.actual_cost_microusd, 8000);

      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solicitation_understandings'
      `;
      const columnNames = new Set(columns.map((column) => column.column_name));
      assert.equal(columnNames.has("prompt_version"), true);
      assert.equal(columnNames.has("prompt"), false);
      assert.equal(columnNames.has("prompt_text"), false);
      assert.equal(columnNames.has("prompt_content"), false);
    } finally {
      if (sourceRecordPk) {
        await sql`DELETE FROM source_records WHERE id = ${sourceRecordPk}`;
      }
      await sql`
        DELETE FROM document_extractions
        WHERE checksum_sha256 = ${checksum}
          AND extractor_name = ${extractorName}
      `;
      await sql.end({ timeout: 5 });
    }
  },
);
