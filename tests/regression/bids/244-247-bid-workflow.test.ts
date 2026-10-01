// Regression contract for issues #244-#247. Added before production changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
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

function questionWorkspace(rows: Array<{ id: string; requirementType: string; text: string; isRequired?: boolean }>) {
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
      responseNotes: null,
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

test("bidder-specific and choice requirements remain questions", () => {
  assert.equal(requirementNeedsBidderQuestion(requirement(
    "pricing",
    "Provide unit and extended pricing including freight.",
  )), true);
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

test("repeated manufacturer warranty facts are consolidated while distinct facts remain separate", () => {
  const duplicate = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "Line item 1: Manufacturer shall provide a three-year warranty." },
    { id: "warranty-b", requirementType: "deliverable", text: "Line item 2: Manufacturer shall provide a three-year warranty." },
  ]));
  assert.equal(duplicate.length, 1);

  const distinct = listBidRequirementQuestions(questionWorkspace([
    { id: "warranty-a", requirementType: "deliverable", text: "Product A requires a three-year manufacturer warranty." },
    { id: "warranty-b", requirementType: "deliverable", text: "Product B requires a five-year manufacturer warranty." },
  ]));
  assert.equal(distinct.length, 2);
});

test("question cards keep bidder identity fixed and make fact provenance optional", () => {
  const control = read("components/bid-package-control.tsx");
  assert.doesNotMatch(control, /Who should answer this\?/);
  assert.match(control, /Fact source \(optional\)/i);
  assert.match(control, /The bidder is your company/i);
  assert.match(control, /Inferred assumptions/i);
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
