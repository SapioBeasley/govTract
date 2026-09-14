import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { persistOpportunityDocumentSet } from "@/lib/procurement/documents/persistence";

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
  "changed or removed authoritative documents mark completed understanding stale without creating another automatic run",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("amendment-stale-source");
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
        VALUES (${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Amendment staleness fixture')
        RETURNING id
      `;
      assert.ok(opportunity?.id);

      const baseDocument = {
        sourceDocumentKey: "solicitation-package",
        sourceDocumentId: "source-doc-1",
        name: "solicitation.pdf",
        url: "https://example.invalid/solicitation.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 128,
        sourceVersionId: "v1",
        sourceModifiedAt: new Date("2026-09-01T00:00:00Z"),
        isAmendment: false,
        amendmentLabel: null,
        checksumSha256: sha256("original solicitation"),
        retrievedAt: new Date("2026-09-01T01:00:00Z"),
        contentPersisted: false,
        sourceMetadata: { fixture: true },
      };

      await persistOpportunityDocumentSet({
        opportunityId: opportunity.id,
        documents: [baseDocument],
      });

      const [automaticUnderstanding] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
          model_name, generation_trigger, status, structured_output, processing_completed_at,
          generated_at, completeness_status, coverage_metadata
        ) VALUES (
          ${opportunity.id}, 'original-input', '1', '2', 'fixture', 'fixture-model',
          'automatic_initial', 'completed', ${sql.json({ summary: 'original understanding' })},
          now(), now(), 'complete', '{}'::jsonb
        ) RETURNING id
      `;
      assert.ok(automaticUnderstanding?.id);

      await persistOpportunityDocumentSet({
        opportunityId: opportunity.id,
        documents: [
          {
            ...baseDocument,
            sourceVersionId: "v2",
            sourceModifiedAt: new Date("2026-09-10T00:00:00Z"),
            isAmendment: true,
            amendmentLabel: "Addendum 1",
            checksumSha256: sha256("amended solicitation"),
            retrievedAt: new Date("2026-09-10T01:00:00Z"),
          },
        ],
      });

      const [afterAmendment] = await sql<
        { is_stale: boolean; stale_reason: string | null; stale_at: Date | null }[]
      >`
        SELECT is_stale, stale_reason, stale_at
        FROM solicitation_understandings
        WHERE id = ${automaticUnderstanding.id}
      `;
      assert.equal(afterAmendment?.is_stale, true);
      assert.equal(afterAmendment?.stale_reason, "source_documents_changed");
      assert.ok(afterAmendment?.stale_at);

      const [manualUnderstanding] = await sql<{ id: string }[]>`
        INSERT INTO solicitation_understandings (
          opportunity_id, input_fingerprint, schema_version, prompt_version, model_provider,
          model_name, generation_trigger, status, structured_output, processing_completed_at,
          generated_at, completeness_status, coverage_metadata
        ) VALUES (
          ${opportunity.id}, 'amended-input', '1', '2', 'fixture', 'fixture-model',
          'manual', 'completed', ${sql.json({ summary: 'manual refreshed understanding' })},
          now(), now(), 'complete', '{}'::jsonb
        ) RETURNING id
      `;
      assert.ok(manualUnderstanding?.id);

      await persistOpportunityDocumentSet({ opportunityId: opportunity.id, documents: [] });

      const [afterRemoval] = await sql<{ is_stale: boolean; stale_reason: string | null }[]>`
        SELECT is_stale, stale_reason
        FROM solicitation_understandings
        WHERE id = ${manualUnderstanding.id}
      `;
      assert.equal(afterRemoval?.is_stale, true);
      assert.equal(afterRemoval?.stale_reason, "source_documents_changed");

      const [automaticCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM solicitation_understandings
        WHERE opportunity_id = ${opportunity.id}
          AND generation_trigger = 'automatic_initial'
      `;
      assert.equal(automaticCount?.count, 1);
    } finally {
      if (sourceRecordPk) await sql`DELETE FROM source_records WHERE id = ${sourceRecordPk}`;
      await sql.end({ timeout: 5 });
    }
  },
);
