import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { generateBidOutline, reorderBidOutlineSections, updateBidOutlineSection } from "@/lib/bids/outline-persistence";

test("outline generation is idempotent, retains source links and manual edits across reruns", { skip: !process.env.DATABASE_URL }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let sourceRecordId: string | null = null;
  try {
    const suffix = "bid-outline-" + process.pid + "-" + Date.now();
    const [source] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('outline-test', ${suffix}, '{}'::jsonb, ${suffix}) RETURNING id
    `;
    sourceRecordId = source!.id;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (source_record_id, source, source_opportunity_id, title)
      VALUES (${source!.id}, 'outline-test', ${suffix}, 'Outline test opportunity') RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO bid_workspaces (opportunity_id, title)
      VALUES (${opportunity!.id}, 'Outline test workspace') RETURNING id
    `;
    const structured = {
      summary: "Use Volume I and Volume II.", scope: [], deliverables: [], workBreakdown: [],
      location: [], schedule: [], quantities: [], qualifications: [], insuranceBonding: [],
      mandatoryEvents: [], pricingInstructions: [], submissionComponents: [], evaluationCriteria: [],
      disqualifiers: [], questionsAmbiguities: [],
    };
    const [understanding] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_understandings (
        opportunity_id, input_fingerprint, schema_version, prompt_version,
        model_provider, model_name, generation_trigger, status,
        completeness_status, structured_output
      ) VALUES (
        ${opportunity!.id}, ${suffix}, '1', 'fixture', 'fixture', 'fixture',
        'automatic_initial', 'completed', 'complete', ${sql.json(structured)}
      ) RETURNING id
    `;
    for (const [key, heading, order] of [
      ["tech", "Volume II — Technical Proposal", 2],
      ["cover", "Volume I — Cover Letter", 1],
    ] as const) {
      await sql`
        INSERT INTO solicitation_requirements (
          opportunity_id, solicitation_understanding_id, requirement_key,
          requirement_type, requirement_level, text, source_section, source_finding_key, details
        ) VALUES (
          ${opportunity!.id}, ${understanding!.id}, ${key}, 'submission_instruction',
          'required', ${"Prepare " + heading}, 'submissionComponents', ${key},
          ${sql.json({ responseHeading: heading, responseOrder: order })}
        )
      `;
    }

    const first = await generateBidOutline(workspace!.id);
    assert.ok(first);
    assert.deepEqual(first.sections.map((section) => section.title), [
      "Volume I — Cover Letter", "Volume II — Technical Proposal",
    ]);
    assert.deepEqual(first.sections[0]?.requirementLinks.sourceRequirementKeys, ["cover"]);
    const firstIds = first.sections.map((section) => section.id);
    assert.equal(first.sections[0]?.metadata.understandingId, understanding!.id);
    assert.equal(first.sections[0]?.metadata.snapshotStatus, "unknown");

    const updated = await updateBidOutlineSection(workspace!.id, firstIds[0]!, {
      title: "Edited cover letter",
      content: "Draft response",
      instructions: "My review notes",
    });
    assert.equal(updated?.sections[0]?.wordCount, 2);
    assert.deepEqual(updated?.sections[0]?.requirementLinks.sourceRequirementKeys, ["cover"]);

    const reordered = await reorderBidOutlineSections(workspace!.id, [...firstIds].reverse());
    assert.deepEqual(reordered?.sections.map((section) => section.id), [...firstIds].reverse());

    const again = await generateBidOutline(workspace!.id);
    assert.deepEqual(again?.sections.map((section) => section.id), [...firstIds].reverse());
    assert.equal(again?.sections[1]?.title, "Edited cover letter");
    assert.equal(again?.sections[1]?.content, "Draft response");
    assert.deepEqual(again?.sections[1]?.requirementLinks.sourceRequirementKeys, ["cover"]);
    const count = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM bid_sections WHERE bid_workspace_id = ${workspace!.id}
    `;
    assert.equal(count[0]?.count, "2");
    await assert.rejects(
      () => reorderBidOutlineSections(workspace!.id, [firstIds[0]!, firstIds[0]!]),
      /exactly once/,
    );
  } finally {
    await closeDb();
    if (sourceRecordId) await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
    await sql.end({ timeout: 5 });
  }
});
