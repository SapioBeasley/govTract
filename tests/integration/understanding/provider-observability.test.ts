import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { generateSolicitationUnderstanding } from "@/lib/procurement/understanding/generation";
import type { UnderstandingModelProvider } from "@/lib/procurement/understanding/provider";
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
  summary: "Replace the roof and submit the required closeout package.",
  scope: [{ key: "scope.roof", text: "Replace the existing roof system." }],
  deliverables: [],
  workBreakdown: [],
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

async function seedOpportunity(sql: postgres.Sql) {
  const source = uniqueId("provider-observability-source");
  const sourceOpportunityId = uniqueId("provider-observability-opportunity");
  const [sourceRecord] = await sql<{ id: string }[]>`
    INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
    VALUES (${source}, ${sourceOpportunityId}, '{}'::jsonb, ${sha256(sourceOpportunityId)})
    RETURNING id
  `;
  assert.ok(sourceRecord?.id);

  const [opportunity] = await sql<{ id: string }[]>`
    INSERT INTO opportunities (
      source_record_id, source, source_opportunity_id, title, description, agency_name,
      solicitation_number, due_at
    ) VALUES (
      ${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Roof replacement project',
      'Replace the roof and related flashing.', 'Fixture Agency', 'IFB-OBS-001',
      now() + interval '14 days'
    ) RETURNING id
  `;
  assert.ok(opportunity?.id);

  const documentKey = uniqueId("provider-observability-document");
  const [document] = await sql<{ id: string }[]>`
    INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
    VALUES (${opportunity.id}, ${documentKey}, 'scope.pdf', 'application/pdf')
    RETURNING id
  `;
  assert.ok(document?.id);

  const checksum = sha256(`${documentKey}-content`);
  const [version] = await sql<{ id: string }[]>`
    INSERT INTO opportunity_document_versions (
      opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
    ) VALUES (
      ${document.id}, 1, ${sha256(documentKey)}, ${checksum}, 'scope.pdf', 'application/pdf'
    ) RETURNING id
  `;
  assert.ok(version?.id);

  const segmentText = [
    "Remove the existing roof and flashing.",
    "Install the specified replacement roofing system.",
    "Coordinate access with the facility representative.",
    "Protect occupied spaces during construction.",
    "Submit product data, warranties, and closeout documents.",
    "Complete all work by the contract deadline.",
  ].join(" ");
  const [extraction] = await sql<{ id: string }[]>`
    INSERT INTO document_extractions (
      checksum_sha256, extractor_name, extractor_version, status, source_mime_type,
      source_byte_count, extracted_char_count, extracted_byte_count, segment_count,
      truncated, completed_at
    ) VALUES (
      ${checksum}, 'fixture-extractor', '1', 'extracted', 'application/pdf',
      ${Buffer.byteLength(segmentText)}, ${segmentText.length}, ${Buffer.byteLength(segmentText)}, 1,
      false, now()
    ) RETURNING id
  `;
  assert.ok(extraction?.id);

  await sql`
    INSERT INTO document_extraction_segments (
      document_extraction_id, ordinal, segment_type, locator, content,
      content_hash_sha256, char_count, byte_count
    ) VALUES (
      ${extraction.id}, 0, 'page', ${sql.json({ page: 1 })}, ${segmentText},
      ${sha256(segmentText)}, ${segmentText.length}, ${Buffer.byteLength(segmentText)}
    )
  `;
  await sql`
    INSERT INTO opportunity_document_version_extractions (
      opportunity_document_version_id, document_extraction_id
    ) VALUES (${version.id}, ${extraction.id})
  `;

  return { opportunityId: opportunity.id, sourceRecordId: sourceRecord.id };
}

test(
  "a chunk provider failure persists sanitized diagnostics and counts retry attempts",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const seeded = await seedOpportunity(sql);
    let calls = 0;
    const secret = "AIzaThisMustNeverBePersisted123456789";
    const provider: UnderstandingModelProvider = {
      profile: {
        id: "fixture-pricing-v1",
        provider: "gemini",
        model: "fixture-gemini",
        billingMode: "non_billable",
        inputTokenLimit: 1_000_000,
        outputTokenLimit: 32_000,
        inputCostMicrousdPerMillionTokens: 750_000,
        outputCostMicrousdPerMillionTokens: 3_750_000,
      },
      modelVersion: "fixture-gemini-v1",
      async generate() {
        calls += 1;
        if (calls >= 2) {
          throw new Error(
            `Gemini generateContent failed with HTTP 429: quota exhausted; x-goog-api-key=${secret}`,
          );
        }
        return {
          content,
          modelVersion: "fixture-gemini-v1",
          usage: {
            promptTokenCount: 100,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 0,
            totalTokenCount: 140,
          },
        };
      },
    };

    try {
      const result = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "manual",
        explicitManualUserAction: true,
        provider,
        budgetPolicy: {
          automaticMaxCostMicrousd: 0,
          manualMaxCostMicrousd: 0,
          perDocumentCharBudget: 10_000,
          perOpportunityCharBudget: 10_000,
          maxChunkChars: 80,
          maxOutputTokensPerCall: 512,
        },
      });

      assert.equal(result.state, "completed");
      if (result.state !== "completed") return;
      assert.equal(result.completenessStatus, "partial");
      assert.equal(result.incompleteReason, "chunk_failure");
      assert.equal(calls, 4);

      const [run] = await sql<{
        usage_metadata: {
          providerCallCount?: number;
          providerFailures?: Array<{
            provider?: string;
            model?: string;
            chunkKey?: string | null;
            category?: string;
            httpStatus?: number | null;
            message?: string;
          }>;
        };
      }[]>`
        SELECT usage_metadata
        FROM solicitation_understandings
        WHERE id = ${result.understandingId}
      `;
      assert.equal(run?.usage_metadata.providerCallCount, 4);
      assert.equal(run?.usage_metadata.providerFailures?.length, 3);

      const failure = run?.usage_metadata.providerFailures?.[0];
      assert.equal(failure?.provider, "gemini");
      assert.equal(failure?.model, "fixture-gemini");
      assert.equal(failure?.category, "http_error");
      assert.equal(failure?.httpStatus, 429);
      assert.match(failure?.message ?? "", /quota exhausted/i);
      assert.doesNotMatch(failure?.message ?? "", new RegExp(secret));
      assert.match(failure?.message ?? "", /\[REDACTED\]/);

      const [firstSkipped] = await sql<{ chunk_key: string; skip_reason: string | null }[]>`
        SELECT chunk_key, skip_reason
        FROM solicitation_understanding_chunks
        WHERE solicitation_understanding_id = ${result.understandingId}
          AND status = 'skipped'
        ORDER BY ordinal ASC
        LIMIT 1
      `;
      assert.equal(firstSkipped?.skip_reason, "provider_failure");
      assert.equal(failure?.chunkKey, firstSkipped?.chunk_key);
    } finally {
      await sql`DELETE FROM source_records WHERE id = ${seeded.sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);
