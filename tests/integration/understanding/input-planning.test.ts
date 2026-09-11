import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import {
  loadPersistedUnderstandingDocuments,
  loadReusableUnderstandingChunkFingerprints,
  markUnderstandingStaleIfInputChanged,
} from "@/lib/procurement/understanding/persistence";

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
  "planning inputs come from persisted current extractions and prior chunk outputs are reusable",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("understanding-input-source");
    const sourceOpportunityId = uniqueId("opportunity");
    let sourceRecordPk: string | null = null;

    try {
      const [sourceRecord] = await sql<{ id: string }[]>`
        INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
        VALUES (${source}, ${sourceOpportunityId}, '{}'::jsonb, ${sha256(sourceOpportunityId)})
        RETURNING id
      `;
      assert.ok(sourceRecord?.id);
      sourceRecordPk = sourceRecord.id;

      const [opportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
        VALUES (${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Persisted understanding inputs')
        RETURNING id
      `;
      assert.ok(opportunity?.id);

      const [document] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
        VALUES (${opportunity.id}, ${uniqueId("document")}, 'scope.pdf', 'application/pdf')
        RETURNING id
      `;
      assert.ok(document?.id);

      const [oldVersion] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
        ) VALUES (
          ${document.id}, 1, ${sha256("old-version")}, ${sha256("old-content")}, 'scope.pdf', 'application/pdf'
        ) RETURNING id
      `;
      assert.ok(oldVersion?.id);

      const currentChecksum = sha256("current-content");
      const [currentVersion] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
        ) VALUES (
          ${document.id}, 2, ${sha256("current-version")}, ${currentChecksum}, 'scope.pdf', 'application/pdf'
        ) RETURNING id
      `;
      assert.ok(currentVersion?.id);

      const [unsupportedDocument] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
        VALUES (${opportunity.id}, ${uniqueId("image")}, 'site-photo.png', 'image/png')
        RETURNING id
      `;
      const [unsupportedVersion] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
        ) VALUES (
          ${unsupportedDocument.id}, 1, ${sha256("image-version")}, ${sha256("image")}, 'site-photo.png', 'image/png'
        ) RETURNING id
      `;
      assert.ok(unsupportedVersion?.id);

      const extractorName = uniqueId("extractor");
      const [extraction] = await sql<{ id: string }[]>`
        INSERT INTO document_extractions (
          checksum_sha256, extractor_name, extractor_version, status, source_mime_type,
          source_byte_count, extracted_char_count, extracted_byte_count, segment_count,
          truncated, completed_at
        ) VALUES (
          ${currentChecksum}, ${extractorName}, '1', 'extracted', 'application/pdf',
          64, 24, 24, 1, false, now()
        ) RETURNING id
      `;
      assert.ok(extraction?.id);

      const segmentContent = 'Current persisted scope.';
      await sql`
        INSERT INTO document_extraction_segments (
          document_extraction_id, ordinal, segment_type, locator, content,
          content_hash_sha256, char_count, byte_count
        ) VALUES (
          ${extraction.id}, 0, 'page', ${sql.json({ page: 1 })}, ${segmentContent},
          ${sha256(segmentContent)}, ${segmentContent.length}, ${Buffer.byteLength(segmentContent, 'utf8')}
        )
      `;
      await sql`
        INSERT INTO opportunity_document_version_extractions (
          opportunity_document_version_id, document_extraction_id
        ) VALUES (${currentVersion.id}, ${extraction.id})
      `;

      const inputs = await loadPersistedUnderstandingDocuments(opportunity.id);
      assert.equal(inputs.length, 2);
      const supported = inputs.find((input) => input.documentVersionId === currentVersion.id);
      const unsupported = inputs.find((input) => input.documentVersionId === unsupportedVersion.id);
      assert.ok(supported);
      assert.equal(supported.checksumSha256, currentChecksum);
      assert.equal(supported.extractionStatus, 'extracted');
      assert.equal(supported.segments.length, 1);
      assert.equal(supported.segments[0]?.content, segmentContent);
      assert.equal(inputs.some((input) => input.documentVersionId === oldVersion.id), false);
      assert.equal(unsupported?.extractionStatus, 'unsupported');

      const [understanding] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
          model_name, generation_trigger, status, structured_output, processing_completed_at,
          generated_at, completeness_status, incomplete_reason, coverage_metadata
        ) VALUES (
          ${opportunity.id}, 'old-fingerprint', '1', 'understanding-v1', 'fixture',
          'fixture-model', 'manual', 'completed', ${sql.json({ summary: 'fixture' })}, now(),
          now(), 'partial', 'budget_limit', ${sql.json({ documentsTotal: 2 })}
        ) RETURNING id
      `;
      assert.ok(understanding?.id);

      const reusableFingerprint = sha256('reusable-chunk');
      await sql`
        INSERT INTO solicitation_understanding_chunks (
          solicitation_understanding_id, opportunity_document_version_id, document_extraction_id,
          chunk_key, input_fingerprint, ordinal, status, char_count, structured_output
        ) VALUES (
          ${understanding.id}, ${currentVersion.id}, ${extraction.id}, 'chunk-0',
          ${reusableFingerprint}, 0, 'processed', 24, ${sql.json({ summary: 'chunk output' })}
        )
      `;

      const reusable = await loadReusableUnderstandingChunkFingerprints(opportunity.id);
      assert.deepEqual([...reusable], [reusableFingerprint]);

      const unchanged = await markUnderstandingStaleIfInputChanged({
        understandingId: understanding.id,
        currentInputFingerprint: 'old-fingerprint',
      });
      assert.equal(unchanged, false);

      const changed = await markUnderstandingStaleIfInputChanged({
        understandingId: understanding.id,
        currentInputFingerprint: 'new-fingerprint',
      });
      assert.equal(changed, true);
      const [state] = await sql<{ is_stale: boolean; stale_reason: string | null }[]>`
        SELECT is_stale, stale_reason FROM solicitation_understandings WHERE id = ${understanding.id}
      `;
      assert.equal(state?.is_stale, true);
      assert.equal(state?.stale_reason, 'input_changed');
    } finally {
      if (sourceRecordPk) await sql`DELETE FROM source_records WHERE id = ${sourceRecordPk}`;
      await sql.end({ timeout: 5 });
    }
  },
);
