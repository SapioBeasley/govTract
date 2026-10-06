// Regression contract for issues #244-#247. Added before production changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  questionForBidRequirement,
  requirementNeedsBidderQuestion,
} from "@/lib/bids/requirement-question-rules";
import { listBidRequirementQuestions } from "@/lib/bids/requirement-questions";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function requirement(
  requirementType: string,
  text: string,
  isRequired = true,
) {
  return { requirementType, text, isRequired } as Parameters<typeof requirementNeedsBidderQuestion>[0] & {
    text: string;
    isRequired: boolean;
  };
}

function questionWorkspace(rows: Array<{
  id: string;
  requirementType: string;
  text: string;
  isRequired?: boolean;
  responseNotes?: string | null;
}>) {
  return {
    sourceRequirements: {
      understandingId: "understanding-current",
      isStale: false,
      completenessStatus: "complete",
      incompleteReasons: [],
      requirements: [],
    },
    sourceSnapshot: {
      pursuitSnapshotId: "snapshot-current",
    },
    requirements: rows.map((row, index) => ({
      id: row.id,
      sourceRequirementKey: `understanding-current:source-${row.id}`,
      requirementType: row.requirementType,
      text: row.text,
      isRequired: row.isRequired ?? true,
      status: "needs_review",
      effectiveStatus: "needs_review",
      canMarkComplete: true,
      evidence: {
        understandingId: "understanding-current",
        sourceRequirementId: `source-${row.id}`,
        sourceFindingKey: `finding-${row.id}`,
        pursuitSnapshotId: "snapshot-current",
        references: [],
        issues: [],
      },
      responseNotes: row.responseNotes ?? null,
      sortOrder: index,
    })),
  } as unknown as BidWorkspaceRecord;
}

test("required scope and quantity are inferred instead of becoming confirmation questions", () => {
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "scope",
    "Provide twenty heavy-duty folding chairs.",
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "quantity",
    "Quantity required: 20 units.",
  )), false);
});

test("unknown requiredness does not turn prescribed buyer scope into optional bidder questions", () => {
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "work",
    "Vendor shall apply water to each newly planted tree.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "quantity",
    "A total of 211 trees will be planted at the two locations.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "schedule",
    "The Contractor shall complete this contract within thirty (30) calendar days.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "scope",
    "Optional line item: additional tree watering visits.",
    false,
  )), true);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "schedule",
    "State the bidder's proposed completion schedule.",
    false,
  )), true);
});

test("prescribed compliance commitments are not generic bidder questions", () => {
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "deliverable",
    "Contractor provides a 2-year warranty and replaces dead trees during the warranty period.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "insurance",
    "Comply with City insurance requirements and provide insurance certificates within three days of request.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "qualification",
    "Employ individuals skilled in their respective trades and maintain prevailing workmanship standards.",
    false,
  )), false);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "qualification",
    "The bidder must represent that it is an Equal Opportunity Employer.",
    true,
  )), false);
});

test("actual bidder facts, choices, and priced line items remain questions", () => {
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "pricing",
    "Provide unit and extended pricing including freight.",
  )), true);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "license",
    "Bidder must hold a current Texas pesticide applicator license.",
  )), true);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "deliverable",
    "Supply 211 eachs of Mixed Native 15 Gallon Trees; Vendors will select from the attached Park Tree List.",
  )), true);
  assert.match(questionForBidRequirement(requirement(
    "deliverable",
    "Supply 211 eachs of Mixed Native 15 Gallon Trees; Vendors will select from the attached Park Tree List.",
  )), /price/i);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "schedule",
    "State delivery lead time after receipt of order.",
  )), true);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "scope",
    "Bidder may offer an approved alternate or substitution and must identify the make and model.",
  )), true);
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "scope",
    "Optional line item: additional carrying case.",
    false,
  )), true);
});

test("manufacturer-specific warranty facts are consolidated while contractor commitments are inferred", () => {
  const duplicate = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "Line item 1: Manufacturer shall provide a three-year warranty." },
    { id: "warranty-b", requirementType: "deliverable", text: "Line item 2: Manufacturer shall provide a three-year warranty." },
  ]));
  assert.equal(duplicate.length, 1);

  const contractorCommitments = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "All trees carry a two (2) year warranty beginning when planted." },
    { id: "warranty-b", requirementType: "deliverable", text: "Contractor provides a 2-year warranty and replaces dead trees during the warranty period." },
  ]));
  assert.equal(contractorCommitments.length, 0);

  const distinct = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "Product A requires a three-year manufacturer warranty." },
    { id: "warranty-b", requirementType: "deliverable", text: "Product B requires a five-year manufacturer warranty." },
  ]));
  assert.equal(distinct.length, 2);
});

test("an existing saved manufacturer fact satisfies the shared duplicate question", () => {
  const questions = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "Line item 1: Manufacturer shall provide a three-year warranty." },
    {
      id: "warranty-b",
      requirementType: "deliverable",
      text: "Line item 2: Manufacturer shall provide a three-year warranty.",
      responseNotes: "Manufacturer confirms a three-year warranty.",
    },
  ]));
  assert.equal(questions.length, 1);
  assert.equal(questions[0]?.id, "warranty-b");
  assert.match(questions[0]?.responseNotes ?? "", /three-year warranty/i);
});

test("question cards keep bidder identity fixed and make fact provenance optional", () => {
  const control = read("components/bid-package-control.tsx");
  assert.doesNotMatch(control, /Who should answer this\?/);
  assert.match(control, /Fact source \(optional\)/i);
  assert.match(control, /The bidder is your company/i);
  assert.match(control, /Inferred assumptions/i);
});

test("draft step does not claim readiness while the retained source package is blocked", () => {
  const control = read("components/bid-package-control.tsx");

  assert.match(control, /sourcePackageReady = sourceReady && sourceBlockers\.length === 0/);
  assert.match(control, /sourcePackageReady\s*\?\s*"Ready to draft"\s*:\s*"Source files blocked"/);
  assert.match(control, /disabled=\{!sourcePackageReady \|\| pending \|\| changed \|\| !inputsReady\}/);
});

test("primary workflow ends with external submission and advanced diagnostics do not interrupt it", () => {
  const review = read("components/bid-final-review.tsx");
  const page = read("app/bids/[id]/page.tsx");

  const supporting = review.indexOf("Supporting documents");
  const approval = review.indexOf("Approve current package");
  const submission = review.indexOf("Authoritative submission handoff");
  assert.ok(supporting >= 0 && approval > supporting && submission > approval,
    "supporting documents must precede approval, and external submission must be last");

  assert.ok(
    page.indexOf('id="final-review"') < page.indexOf('id="source-documents-and-technical-details"'),
    "advanced source diagnostics must be subordinate to the primary workflow",
  );
});

test("normal workspace UI no longer exposes manual status or review-state selectors", () => {
  const control = read("components/bid-workspace-control.tsx");
  const listPage = read("app/bids/page.tsx");
  const detailPage = read("app/bids/[id]/page.tsx");

  assert.doesNotMatch(control, /Workspace status/);
  assert.doesNotMatch(control, /Review state/);
  assert.match(listPage, /workflowStatus/);
  assert.match(detailPage, /workflowStatus/);
  assert.doesNotMatch(detailPage, /Review \{workspace\.reviewState/);
});
