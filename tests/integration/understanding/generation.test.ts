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
  summary: "Replace the facility roof, coordinate access, and submit all required closeout material.",
  scope: [{ key: "scope.roof", text: "Remove and replace the existing roof system." }],
  deliverables: [{ key: "deliverables.closeout", text: "Provide required closeout documents." }],
  workBreakdown: [
    { key: "work.remove", text: "Remove existing roofing." },
    { key: "work.install", text: "Install the specified replacement system." },
  ],
  location: [{ key: "location.site", text: "Perform work at the agency facility." }],
  schedule: [{ key: "schedule.deadline", text: "Meet the solicitation schedule and completion deadline." }],
  quantities: [],
  qualifications: [{ key: "qualifications.contractor", text: "Meet stated contractor qualification requirements." }],
  insuranceBonding: [],
  mandatoryEvents: [],
  pricingInstructions: [{ key: "pricing.form", text: "Price the official bid form as instructed." }],
  submissionComponents: [{ key: "submission.bid", text: "Submit the completed bid form." }],
  evaluationCriteria: [{ key: "evaluation.responsive", text: "The agency evaluates bid responsiveness." }],
  disqualifiers: [{ key: "disqualifier.late", text: "A late bid may be rejected." }],
  questionsAmbiguities: [],
};

function fakeProvider(options: { billingMode: "billable" | "non_billable"; onGenerate?: () => void }): UnderstandingModelProvider {
  return {
    profile: {
      id: "fixture-pricing-v1",
      provider: "fixture",
      model: "fixture-model",
      billingMode: options.billingMode,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 32_000,
      inputCostMicrousdPerMillionTokens: 750_000,
      outputCostMicrousdPerMillionTokens: 3_750_000,
    },
    modelVersion: "fixture-model-v1",
    async generate() {
      options.onGenerate?.();
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

async function seedOpportunity(sql: postgres.Sql, options: { withExtractedDocument?: boolean; withPendingDocument?: boolean; description?: string | null } = {}) {
  const source = uniqueId("understanding-source");
  const sourceOpportunityId = uniqueId("opportunity");
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
      ${options.description === undefined ? "Replace the roof and related flashing." : options.description},
      'Fixture Agency', 'IFB-2026-001', now() + interval '14 days'
    ) RETURNING id
  `;
  assert.ok(opportunity?.id);

  async function addDocument(state: "extracted" | "pending") {
    const documentKey = uniqueId(`document-${state}`);
    const [document] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_documents (opportunity_id, source_document_key, name, mime_type)
      VALUES (${opportunity.id}, ${documentKey}, ${state === "extracted" ? "scope.pdf" : "pricing.xlsx"}, ${state === "extracted" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
      RETURNING id
    `;
    assert.ok(document?.id);

    const checksum = sha256(`${documentKey}-content`);
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO opportunity_document_versions (
        opportunity_document_id, version_number, fingerprint, checksum_sha256, name, mime_type
      ) VALUES (
        ${document.id}, 1, ${sha256(documentKey)}, ${checksum},
        ${state === "extracted" ? "scope.pdf" : "pricing.xlsx"},
        ${state === "extracted" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
      ) RETURNING id
    `;
    assert.ok(version?.id);

    if (state === "extracted") {
      const segmentText = "Remove the existing roof. Install the specified system. Submit bid forms by the deadline.";
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
    }
  }

  if (options.withExtractedDocument) await addDocument("extracted");
  if (options.withPendingDocument) await addDocument("pending");
  return { opportunityId: opportunity.id, sourceRecordId: sourceRecord.id };
}

test(
  "automatic generation calls the model once, persists actionable output, and reuses it on later automatic attempts",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const seeded = await seedOpportunity(sql, { withExtractedDocument: true });
    let calls = 0;
    const provider = fakeProvider({ billingMode: "non_billable", onGenerate: () => calls++ });

    try {
      const first = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(first.state, "completed");
      assert.equal(calls, 1);
      if (first.state !== "completed") return;
      assert.equal(first.content.workBreakdown.length, 2);
      assert.equal(first.content.submissionComponents.length, 1);
      assert.equal(first.content.evaluationCriteria.length, 1);
      assert.equal(first.content.disqualifiers.length, 1);

      const second = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(second.state, "reused");
      assert.equal(calls, 1, "page/job retries must not invoke AI again automatically");

      const [row] = await sql<{
        generation_trigger: string;
        status: string;
        completeness_status: string;
        structured_output: SolicitationUnderstandingContent;
        model_provider: string;
        model_name: string;
        input_token_count: string | null;
        output_token_count: string | null;
      }[]>`
        SELECT generation_trigger, status, completeness_status, structured_output,
               model_provider, model_name, input_token_count, output_token_count
        FROM solicitation_understandings
        WHERE opportunity_id = ${seeded.opportunityId}
      `;
      assert.equal(row?.generation_trigger, "automatic_initial");
      assert.equal(row?.status, "completed");
      assert.equal(row?.completeness_status, "complete");
      assert.equal(row?.structured_output.summary, content.summary);
      assert.equal(row?.model_provider, "fixture");
      assert.equal(row?.model_name, "fixture-model");
      assert.equal(Number(row?.input_token_count), 100);
      assert.equal(Number(row?.output_token_count), 40);
    } finally {
      await sql`DELETE FROM source_records WHERE id = ${seeded.sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  "$0 policy blocks a billable provider before any model call and does not consume the one automatic cycle",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const seeded = await seedOpportunity(sql, { withExtractedDocument: true });
    let calls = 0;
    const provider = fakeProvider({ billingMode: "billable", onGenerate: () => calls++ });

    try {
      const result = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(result.state, "blocked");
      if (result.state === "blocked") assert.equal(result.reason, "budget_exceeded");
      assert.equal(calls, 0);

      const [count] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM solicitation_understandings
        WHERE opportunity_id = ${seeded.opportunityId}
      `;
      assert.equal(Number(count?.count), 0, "a preflight budget block is not an AI processing cycle");
    } finally {
      await sql`DELETE FROM source_records WHERE id = ${seeded.sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  "automatic generation waits for supported document extraction instead of consuming the one-shot run too early",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const seeded = await seedOpportunity(sql, { withExtractedDocument: true, withPendingDocument: true });
    let calls = 0;

    try {
      const result = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "automatic_initial",
        explicitManualUserAction: false,
        provider: fakeProvider({ billingMode: "non_billable", onGenerate: () => calls++ }),
      });
      assert.equal(result.state, "blocked");
      if (result.state === "blocked") assert.equal(result.reason, "documents_pending");
      assert.equal(calls, 0);
    } finally {
      await sql`DELETE FROM source_records WHERE id = ${seeded.sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  "manual generation requires an explicit user action and source metadata can generate without historical intelligence",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const seeded = await seedOpportunity(sql, { description: "Provide roof replacement services." });
    let calls = 0;
    const provider = fakeProvider({ billingMode: "non_billable", onGenerate: () => calls++ });

    try {
      const rejected = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "manual",
        explicitManualUserAction: false,
        provider,
      });
      assert.equal(rejected.state, "blocked");
      if (rejected.state === "blocked") assert.equal(rejected.reason, "manual_user_action_required");
      assert.equal(calls, 0);

      const generated = await generateSolicitationUnderstanding({
        opportunityId: seeded.opportunityId,
        trigger: "manual",
        explicitManualUserAction: true,
        provider,
      });
      assert.equal(generated.state, "completed");
      assert.equal(calls, 1);

      const [row] = await sql<{ generation_trigger: string; status: string }[]>`
        SELECT generation_trigger, status FROM solicitation_understandings
        WHERE opportunity_id = ${seeded.opportunityId}
      `;
      assert.equal(row?.generation_trigger, "manual");
      assert.equal(row?.status, "completed");
    } finally {
      await sql`DELETE FROM source_records WHERE id = ${seeded.sourceRecordId}`;
      await sql.end({ timeout: 5 });
    }
  },
);
