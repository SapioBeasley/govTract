import assert from "node:assert/strict";
import test from "node:test";

import { deriveBidWorkflowStatus } from "@/lib/bids/workflow-status";

const base = {
  inputsPrepared: true,
  requiredQuestionCount: 2,
  answeredRequiredQuestionCount: 2,
  hasCurrentDraft: false,
  readyForFinalApproval: false,
  approvalCurrent: false,
  submissionCurrent: false,
};

test("workflow status advances from inputs through explicit submission", () => {
  assert.equal(deriveBidWorkflowStatus({ ...base, inputsPrepared: false }).key, "started");
  assert.equal(deriveBidWorkflowStatus({ ...base, answeredRequiredQuestionCount: 1 }).key, "started");
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

test("new unresolved inputs roll a previously drafted workspace back without deleting history", () => {
  const status = deriveBidWorkflowStatus({
    ...base,
    requiredQuestionCount: 3,
    answeredRequiredQuestionCount: 2,
    hasCurrentDraft: true,
    readyForFinalApproval: false,
    approvalCurrent: false,
    submissionCurrent: false,
  });
  assert.equal(status.key, "started");
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
