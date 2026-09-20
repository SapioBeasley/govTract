import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { loadLatestSolicitationRequirements } from "@/lib/procurement/requirements/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("hydrates legacy null evidence from the exact linked version and checksum without replacing saved excerpts", { skip: !canRun }, async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const marker = `excerpt-hydration-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const checksum = hash(marker);
  const differentChecksum = hash(marker + "-different");
  let sourceRecordId: string | null = null;
  try {
    const [sourceRecord] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('fixture-excerpts', ${marker}, '{}'::jsonb, ${checksum})
      RETURNING id
    `;
    sourceRecordId = sourceRecord.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${sourceRecord.id}, 'fixture-excerpts', ${marker}, 'Excerpt hydration fixture')
      RETURNING id
    `;
    const [doc] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity.id}, ${marker}, 'Original scope.pdf', 'application/pdf')
      RETURNING id
    `;
    const [good] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions
        (opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type)
      VALUES (${doc.id}, 1, ${hash(marker + "-v1")}, ${checksum}, 'Original scope.pdf', 'application/pdf')
      RETURNING id
    `;
    const [bad] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions
        (opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type)
      VALUES (${doc.id}, 2, ${hash(marker + "-v2")}, ${differentChecksum}, 'Original scope.pdf', 'application/pdf')
      RETURNING id
    `;
    const [extraction] = await sql<{ id: string }[]>`
      INSERT INTO document_extractions (checksum_sha256, extractor_name, extractor_version, status)
      VALUES (${checksum}, ${marker}, '1', 'extracted') RETURNING id
    `;
    const content = "Unrelated specifications. ".repeat(100) +
      "The supplier must deliver the assembled unit to the City of Houston Cullen Service Center facility. " +
      "Other information. ".repeat(100);
    const [segment] = await sql<{ id: string }[]>`
      INSERT INTO document_extraction_segments
        (document_extraction_id, ordinal, segment_type, locator, content, content_hash_sha256, char_count, byte_count)
      VALUES (${extraction.id}, 0, 'page', ${sql.json({ page: 2 })},
        ${content}, ${hash(content)}, ${content.length}, ${Buffer.byteLength(content, "utf8")})
      RETURNING id
    `;
    await sql`
      INSERT INTO opportunity_document_version_extractions (opportunity_document_version_id, document_extraction_id)
      VALUES (${good.id}, ${extraction.id}), (${bad.id}, ${extraction.id})
    `;
    const output = {
      summary: "Deliver equipment.",
      scope: [], deliverables: [{ key: "assembled_unit_delivery", text: "Deliver the assembled unit to Cullen Service Center." }],
      workBreakdown: [], location: [], schedule: [], quantities: [], qualifications: [],
      insuranceBonding: [], mandatoryEvents: [], pricingInstructions: [], submissionComponents: [],
      evaluationCriteria: [], disqualifiers: [], questionsAmbiguities: [],
    };
    const [understanding] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_understandings
        (opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
         model_name, generation_trigger, status, completeness_status, structured_output)
      VALUES (${opportunity.id}, ${hash(marker + "-run")}, '1', 'fixture', 'fixture', 'fixture',
        'manual', 'completed', 'complete', ${sql.json(output)})
      RETURNING id
    `;
    await sql`
      INSERT INTO solicitation_requirements
        (opportunity_id, solicitation_understanding_id, requirement_key, requirement_type,
         requirement_level, text, source_section, source_finding_key)
      VALUES (${opportunity.id}, ${understanding.id}, 'deliverables:assembled_unit_delivery',
        'deliverable', 'required', 'Deliver the assembled unit to Cullen Service Center.',
        'deliverables', 'assembled_unit_delivery')
    `;
    await sql`
      INSERT INTO solicitation_understanding_evidence
        (solicitation_understanding_id, finding_key, opportunity_document_version_id,
         document_extraction_segment_id, locator, excerpt)
      VALUES
        (${understanding.id}, 'assembled_unit_delivery', ${good.id}, ${segment.id}, ${sql.json({ page: 2 })}, NULL),
        (${understanding.id}, 'assembled_unit_delivery', ${bad.id}, ${segment.id}, ${sql.json({ page: 2 })}, NULL),
        (${understanding.id}, 'assembled_unit_delivery', ${good.id}, ${segment.id}, ${sql.json({ page: 2 })}, 'Already preserved verbatim proof.')
    `;
    const loaded = await loadLatestSolicitationRequirements(opportunity.id);
    assert.ok(loaded);
    assert.equal(loaded.understandingId, understanding.id);
    const references = loaded.requirements[0]?.evidence ?? [];
    assert.equal(references.length, 3);
    // Evidence references are ordered by generated version UUID, not INSERT order.
    // Identify each assertion by immutable version identity and saved excerpt state.
    const recovered = references.find((ref) =>
      ref.opportunityDocumentVersionId === good.id && ref.excerpt !== "Already preserved verbatim proof.");
    const mismatch = references.find((ref) => ref.opportunityDocumentVersionId === bad.id);
    const preserved = references.find((ref) => ref.excerpt === "Already preserved verbatim proof.");
    assert.ok(recovered?.excerpt?.includes("deliver the assembled unit to the City of Houston Cullen Service Center"),
      "legacy null evidence must hydrate the relevant verbatim source passage");
    assert.ok((recovered?.excerpt?.length ?? 0) <= 480, "source evidence must be bounded");
    assert.ok(content.includes(recovered!.excerpt!), "excerpt must be exact source text, not a paraphrase");
    assert.equal(recovered?.documentExtractionSegmentId, segment.id);
    assert.deepEqual(recovered?.locator, { page: 2 });
    assert.equal(mismatch?.excerpt, null, "a linked segment with a mismatched version checksum is not trusted");
    assert.equal(preserved?.opportunityDocumentVersionId, good.id);
    const [saved] = await sql<{ count: number }[]>`
      SELECT count(*) FILTER (WHERE excerpt IS NULL)::int AS count
      FROM solicitation_understanding_evidence WHERE solicitation_understanding_id = ${understanding.id}
    `;
    assert.equal(saved.count, 2, "read-side hydration must not alter historical evidence rows or reprocess AI");
  } finally {
    if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
    await sql`DELETE FROM document_extractions WHERE checksum_sha256 = ${checksum} AND extractor_name = ${marker}`;
    await sql.end({ timeout: 5 });
  }
});
