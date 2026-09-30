import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { listBidRequirementQuestions } from "@/lib/bids/requirement-questions";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace is question-first and no longer collects transient answers from generated draft prose", () => {
  const control = read("components/bid-package-control.tsx");

  assert.match(control, /Generate requirement questions/i);
  assert.match(control, /Draft bid/i);
  assert.match(control, /subcontractor|manufacturer/i);
  assert.doesNotMatch(control, /setAnswers\(\{\}\)/,
    "draft generation must not clear persisted requirement responses");
  assert.doesNotMatch(control, /Update bid with my answers/i,
    "draft-derived Needs Input answers are no longer the primary workflow");
});

test("requirement responses persist independently with response-source provenance", () => {
  const schema = read("lib/db/canonical-schema.ts");
  const route = read("app/api/bids/[id]/requirements/[requirementId]/response/route.ts");

  assert.match(schema, /responseSourceType/);
  assert.match(schema, /responseSourceName/);
  assert.match(route, /responseSourceType/);
  assert.match(route, /responseSourceName/);
  assert.match(route, /responseNotes/);
});

test("drafting consumes persisted bidder or supplier responses as separate non-source context", () => {
  const draftInput = read("lib/bids/draft-input.ts");
  const provider = read("lib/bids/draft-provider.ts");
  const persistence = read("lib/bids/draft-persistence.ts");

  assert.match(draftInput, /bidderResponseContext/);
  assert.match(provider, /USER\/SUPPLIER RESPONSES/i);
  assert.match(provider, /not solicitation evidence/i);
  assert.match(persistence, /workspace\.requirements/);
});

test("question generation is deterministic and does not call the model", () => {
  const route = read("app/api/bids/[id]/questions/route.ts");
  const questions = read("lib/bids/requirement-questions.ts");
  const rules = read("lib/bids/requirement-question-rules.ts");

  assert.match(route, /generateBidRequirementQuestions/);
  assert.doesNotMatch(route + questions + rules, /createGemini|generateContent|provider\.generate/i);
  assert.match(rules, /form|submission_instruction/);
});


test("evidence-only partial source sets still expose current bidder and supplier questions", () => {
  const base = {
    sourceRequirements: {
      understandingId: "understanding-current",
      isStale: false,
      completenessStatus: "partial",
      incompleteReasons: ["requirement_evidence_missing"],
      requirements: [],
    },
    sourceSnapshot: {
      pursuitSnapshotId: "snapshot-current",
    },
    requirements: [
      {
        id: "deliverable-question",
        sourceRequirementKey: "understanding-current:source-deliverable",
        requirementType: "deliverable",
        text: "Provide the specified equipment.",
        isRequired: true,
        status: "needs_review",
        effectiveStatus: "needs_review",
        canMarkComplete: false,
        evidence: {
          understandingId: "understanding-current",
          sourceRequirementId: "source-deliverable",
          sourceFindingKey: "deliverable-finding",
          pursuitSnapshotId: "snapshot-current",
          references: [],
          issues: ["requirement_set_incomplete", "requirement_evidence_missing"],
        },
        responseNotes: null,
        sortOrder: 0,
      },
      {
        id: "package-form",
        sourceRequirementKey: "understanding-current:source-form",
        requirementType: "form",
        text: "Submit the signed form.",
        isRequired: true,
        status: "needs_review",
        effectiveStatus: "needs_review",
        canMarkComplete: false,
        evidence: {
          understandingId: "understanding-current",
          sourceRequirementId: "source-form",
          sourceFindingKey: "form-finding",
          pursuitSnapshotId: "snapshot-current",
          references: [],
          issues: ["requirement_set_incomplete", "requirement_evidence_missing"],
        },
        responseNotes: null,
        sortOrder: 1,
      },
    ],
  } as unknown as BidWorkspaceRecord;

  const questions = listBidRequirementQuestions(base);
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.id, "deliverable-question");
  assert.match(questions[0]?.question ?? "", /supplier provide/i);

  const nonDraftable = {
    ...base,
    sourceRequirements: {
      ...base.sourceRequirements!,
      incompleteReasons: ["document_extraction_failed"],
    },
  } as unknown as BidWorkspaceRecord;
  assert.deepEqual(listBidRequirementQuestions(nonDraftable), []);
});

test("stepper marks the workspace start complete and advances from generated question count", () => {
  const control = read("components/bid-package-control.tsx");
  assert.match(control, /\["1", "Start bid", "Complete"\]/);
  assert.match(control, /questionsGenerated \? `\$\{initialQuestions\.length\} ready` : "Not generated"/);
  assert.match(control, /questionsGenerated \? `\$\{answeredCount\} of \$\{initialQuestions\.length\} saved` : "Waiting"/);
});
