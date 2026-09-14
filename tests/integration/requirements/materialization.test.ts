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
  summary: "Submit a responsive bid for the roof replacement project.",
  scope: [{ key: "scope.roof", text: "Remove and replace the existing roof system." }],
  deliverables: [{ key: "deliverables.closeout", text: "Provide required closeout documents." }],
  workBreakdown: [{ key: "work.roof", text: "Remove existing roofing and install the replacement system." }],
  location: [{ key: "location.site", text: "Perform the work at the agency facility." }],
  schedule: [{ key: "schedule.bid-due", text: "Bids must be submitted by 2:00 PM on October 15, 2026." }],
  quantities: [],
  qualifications: [
    { key: "qualifications.license", text: "The contractor must hold the required roofing license." },
    { key: "qualifications.certification", text: "Submit the required manufacturer certification." },
  ],
  insuranceBonding: [
    { key: "insurance.general", text: "Maintain the required general liability insurance." },
    { key: "bonding.bid", text: "Provide the required bid bond." },
  ],
  mandatoryEvents: [
    { key: "mandatory.prebid", text: "Attendance at the mandatory pre-bid meeting is required." },
  ],
  pricingInstructions: [
    { key: "pricing.form", text: "Price the work on the agency's required bid form." },
  ],
  submissionComponents: [
    { key: "submission.form", text: "Submit the completed bid form." },
    {
      key: "submission.alternate",
      text: "An alternate product data sheet is optional.",
      details: { required: false },
    },
  ],
  evaluationCriteria: [{ key: "evaluation.responsiveness", text: "The agency evaluates bid responsiveness." }],
  disqualifiers: [{ key: "disqualifier.late", text: "Late bids will be rejected." }],
  questionsAmbiguities: [],
};

function fakeProvider(onGenerate: () => void): UnderstandingModelProvider {
  return {
    profile: {
      id: "requirements-fixture-pricing-v1",
      provider: "fixture",
      model: "fixture-model",
      billingMode: "non_billable",
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 32_000,
      inputCostMicrousdPerMillionTokens: 0,
      outputCostMicrousdPerMillionTokens: 0,
    },
    modelVersion: "fixture-model-v1",
    async generate() {
      onGenerate();
      return {
        content,
        modelVersion: "fixture-model-v1",
        usage: {
          promptTokenCount: 100,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 0,
          totalTokenCount: 140,
        },
      };
    },
  };
}

test(
  "one automatic understanding cycle persists typed requirements with exact source evidence and reuses them",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const source = uniqueId("requirements-source");
    const sourceOpportunityId = uniqueId("opportunity");
    const documentKey = uniqueId("document");
    const checksum = sha256(`${documentKey}-content`);
    let sourceRecordId: string | null = null;
    let calls = 0;

    try {
      const [sourceRecord] = await sql<{ id: string }[]>`
        INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
        VALUES (${source}, ${sourceOpportunityId}, '{}'::jsonb, ${sha256(sourceOpportunityId)})
        RETURNING id
      `;
      assert.ok(sourceRecord?.id);
      sourceRecordId = sourceRecord.id;

      const [opportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities (
          source_record_id, source, source_opportunity_id, title, description, agency_name,
          solicitation_number, due_at
        ) VALUES (
          ${sourceRecord.id}, ${source}, ${sourceOpportunityId}, 'Roof replacement project',
          'Replace the roof and submit a responsive bid.', 'Fixture Agency', 'IFB-2026-REQ',
          '2026-10-15T19:00:00Z'
        ) RETURNING id
      `;
      assert.ok(opportunity?.id);

      const [document] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
        VALUES (${opportunity.id}, ${documentKey}, 'solicitation.pdf', 'application/pdf')
        RETURNING id
      `;
      assert.ok(document?.id);

      const [version] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
        ) VALUES (
          ${document.id}, 1, ${sha256(documentKey)}, ${checksum}, 'solicitation.pdf', 'application/pdf'
        ) RETURNING id
      `;
      assert.ok(version?.id);

      const segmentText = [
        "Bids must be submitted by 2:00 PM on October 15, 2026.",
        "Attendance at the mandatory pre-bid meeting is required.",
        "Maintain the required general liability insurance and provide the required bid bond.",
        "The contractor must hold the required roofing license and submit the manufacturer certification.",
        "Price the work on the agency bid form and submit the completed form.",
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

      const [segment] = await sql<{ id: string }[]>`
        INSERT INTO document_extraction_segments (
          document_extraction_id, ordinal, segment_type, locator, content,
          content_hash_sha256, char_count, byte_count
        ) VALUES (
          ${extraction.id}, 0, 'page', ${sql.json({ page: 7, section: 'Bid Requirements' })},
          ${segmentText}, ${sha256(segmentText)}, ${segmentText.length}, ${Buffer.byteLength(segmentText)}
        ) RETURNING id
      `;
      assert.ok(segment?.id);

      await sql`
        INSERT INTO opportunity_document_version_extractions (
          opportunity_document_version_id, document_extraction_id
        ) VALUES (${version.id}, ${extraction.id})
      `;

      const provider = fakeProvider(() => calls++);
      const first = await generateSolicitationUnderstanding({
        opportunityId: opportunity.id,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(first.state, "completed");
      assert.equal(calls, 1, "requirement extraction must stay inside the existing AI cycle");

      const rows = await sql<{
        requirement_key: string;
        requirement_type: string;
        requirement_level: string;
        text: string;
        source_finding_key: string;
        opportunity_document_version_id: string | null;
        document_extraction_segment_id: string | null;
        page: string | null;
        section: string | null;
      }[]>`
        SELECT
          r.requirement_key,
          r.requirement_type,
          r.requirement_level,
          r.text,
          r.source_finding_key,
          e.opportunity_document_version_id,
          e.document_extraction_segment_id,
          e.locator ->> 'page' AS page,
          e.locator ->> 'section' AS section
        FROM solicitation_requirements r
        LEFT JOIN solicitation_understanding_evidence e
          ON e.solicitation_understanding_id = r.solicitation_understanding_id
         AND e.finding_key = r.source_finding_key
        WHERE r.opportunity_id = ${opportunity.id}
        ORDER BY r.requirement_key
      `;

      assert.ok(rows.length >= 10);
      const types = new Set(rows.map((row) => row.requirement_type));
      for (const expected of [
        "deadline",
        "mandatory_event",
        "insurance",
        "bonding",
        "license",
        "certification",
        "pricing",
        "form",
        "disqualifier",
      ]) {
        assert.equal(types.has(expected), true, `expected requirement type ${expected}`);
      }

      const optional = rows.find((row) => row.source_finding_key === "submission.alternate");
      assert.equal(optional?.requirement_level, "optional");
      const deadline = rows.find((row) => row.requirement_type === "deadline");
      assert.equal(deadline?.requirement_level, "required");

      for (const row of rows.filter((candidate) => candidate.source_finding_key !== "submission.alternate")) {
        assert.equal(row.opportunity_document_version_id, version.id);
        assert.equal(row.document_extraction_segment_id, segment.id);
        assert.equal(row.page, "7");
        assert.equal(row.section, "Bid Requirements");
      }

      const second = await generateSolicitationUnderstanding({
        opportunityId: opportunity.id,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(second.state, "reused");
      assert.equal(calls, 1, "reusing persisted requirements must not trigger another model call");

      const [count] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM solicitation_requirements
        WHERE opportunity_id = ${opportunity.id}
      `;
      assert.equal(Number(count?.count), rows.length, "automatic retries must not duplicate requirements");
    } finally {
      if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
      await sql`
        DELETE FROM document_extractions
        WHERE checksum_sha256 = ${checksum}
          AND extractor_name = 'fixture-extractor'
      `;
      await sql.end({ timeout: 5 });
    }
  },
);
