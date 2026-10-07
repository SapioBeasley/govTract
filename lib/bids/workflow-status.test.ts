import assert from "node:assert/strict";
import test from "node:test";

import {
  bidInputProgress,
  deriveBidWorkflowStatus,
} from "@/lib/bids/workflow-status";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

const base = {
  inputsPrepared: true,
  questionCount: 2,
  answeredQuestionCount: 2,
  hasCurrentDraft: false,
  readyForFinalApproval: false,
  approvalCurrent: false,
  submissionCurrent: false,
};

test("workflow status advances from inputs through explicit submission", () => {
  assert.equal(deriveBidWorkflowStatus({ ...base, inputsPrepared: false }).key, "started");
  assert.equal(deriveBidWorkflowStatus({ ...base, answeredQuestionCount: 1 }).key, "started");
  assert.equal(deriveBidWorkflowStatus(base).key, "inputs_ready");
  assert.equal(deriveBidWorkflowStatus({ ...base, hasCurrentDraft: true }).key, "draft_ready");
  assert.equal(deriveBidWorkflowStatus({
    ...base,
    hasCurrentDraft: true,
    readyForFinalApproval: true,
  }).key, "ready_for_final_approval");
  assert.equal(deriveBidWorkflowStatus({
    ...base,
    hasCurrentDraft: true,
    readyForFinalApproval: true,
    approvalCurrent: true,
  }).key, "approved");
  assert.equal(deriveBidWorkflowStatus({
    ...base,
    hasCurrentDraft: true,
    readyForFinalApproval: true,
    approvalCurrent: true,
    submissionCurrent: true,
  }).key, "submitted");
});

test("inputs-ready status does not claim the source package is draft-ready", () => {
  const status = deriveBidWorkflowStatus(base);
  assert.equal(status.key, "inputs_ready");
  assert.doesNotMatch(status.description, /ready to draft/i);
  assert.match(status.description, /source package/i);
});

test("new unresolved inputs roll a previously drafted workspace back without deleting history", () => {
  const status = deriveBidWorkflowStatus({
    ...base,
    questionCount: 3,
    answeredQuestionCount: 2,
    hasCurrentDraft: true,
    readyForFinalApproval: false,
    approvalCurrent: false,
    submissionCurrent: false,
  });
  assert.equal(status.key, "started");
});

test("optional or conditional bidder choices count as unresolved bid inputs", () => {
  const workspace = {
    sourceRequirements: {
      understandingId: "understanding-current",
      isStale: false,
      completenessStatus: "complete",
      incompleteReasons: [],
      requirements: [
        { id: "pricing-source" },
        { id: "optional-source" },
      ],
    },
    requirements: [
      {
        id: "pricing-row",
        sourceRequirementKey: "understanding-current:pricing-source",
        requirementType: "pricing",
        text: "Provide unit and extended pricing.",
        isRequired: true,
        responseNotes: "$100 each",
      },
      {
        id: "optional-row",
        sourceRequirementKey: "understanding-current:optional-source",
        requirementType: "scope",
        text: "Optional line item: additional carrying case.",
        isRequired: false,
        responseNotes: null,
      },
    ],
    sections: [],
    finalReview: { readyForHumanReview: false },
    finalReviewApprovalCurrent: false,
    currentSubmission: null,
  } as unknown as BidWorkspaceRecord;

  const progress = bidInputProgress(workspace);
  assert.equal(progress.questionCount, 2);
  assert.equal(progress.answeredQuestionCount, 1);
  assert.equal(progress.unansweredQuestionCount, 1);

  assert.equal(deriveBidWorkflowStatus({
    ...base,
    inputsPrepared: progress.inputsPrepared,
    questionCount: progress.questionCount,
    answeredQuestionCount: progress.answeredQuestionCount,
    hasCurrentDraft: true,
  }).key, "started");
});

test("package revisions roll approval and submission back to the strongest current evidence", () => {
  const status = deriveBidWorkflowStatus({
    ...base,
    hasCurrentDraft: true,
    readyForFinalApproval: false,
    approvalCurrent: false,
    submissionCurrent: false,
  });
  assert.equal(status.key, "draft_ready");
});
