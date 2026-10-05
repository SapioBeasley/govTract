import { selectBidRequirementQuestions } from "@/lib/bids/requirement-question-rules";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";
import { isSolicitationRequirementSetDraftable } from "@/lib/procurement/requirements/readiness";

export const BID_WORKFLOW_STATUS_KEYS = [
  "started",
  "inputs_ready",
  "draft_ready",
  "ready_for_final_approval",
  "approved",
  "submitted",
] as const;

export type BidWorkflowStatusKey = (typeof BID_WORKFLOW_STATUS_KEYS)[number];

export type BidWorkflowStatus = {
  key: BidWorkflowStatusKey;
  label: string;
  description: string;
};

const STATUS: Record<BidWorkflowStatusKey, BidWorkflowStatus> = {
  started: {
    key: "started",
    label: "Started",
    description: "Bid inputs still need preparation or required bidder facts are unresolved.",
  },
  inputs_ready: {
    key: "inputs_ready",
    label: "Inputs ready",
    description: "Required bidder facts are resolved and the bid is ready to draft.",
  },
  draft_ready: {
    key: "draft_ready",
    label: "Draft ready / in review",
    description: "A current saved bid draft exists and is ready for review and editing.",
  },
  ready_for_final_approval: {
    key: "ready_for_final_approval",
    label: "Ready for final approval",
    description: "The current package has no blocking package checks and awaits explicit human approval.",
  },
  approved: {
    key: "approved",
    label: "Approved / ready to submit",
    description: "Human approval is current for the exact package fingerprint.",
  },
  submitted: {
    key: "submitted",
    label: "Submitted",
    description: "An explicit external submission record matches the exact approved package.",
  },
};

export type BidWorkflowStatusInput = {
  inputsPrepared: boolean;
  requiredQuestionCount: number;
  answeredRequiredQuestionCount: number;
  hasCurrentDraft: boolean;
  readyForFinalApproval: boolean;
  approvalCurrent: boolean;
  submissionCurrent: boolean;
};

export function deriveBidWorkflowStatus(input: BidWorkflowStatusInput): BidWorkflowStatus {
  if (input.submissionCurrent) return STATUS.submitted;
  if (input.approvalCurrent) return STATUS.approved;

  const unresolvedRequired = Math.max(
    0,
    input.requiredQuestionCount - input.answeredRequiredQuestionCount,
  );
  if (!input.inputsPrepared || unresolvedRequired > 0) return STATUS.started;
  if (input.readyForFinalApproval) return STATUS.ready_for_final_approval;
  if (input.hasCurrentDraft) return STATUS.draft_ready;
  return STATUS.inputs_ready;
}

type WorkflowWorkspace = Pick<
  BidWorkspaceRecord,
  | "sourceRequirements"
  | "requirements"
  | "sections"
  | "finalReview"
  | "finalReviewApprovalCurrent"
  | "currentSubmission"
>;

export function currentBidInputRequirements(workspace: WorkflowWorkspace) {
  const source = workspace.sourceRequirements;
  if (!isSolicitationRequirementSetDraftable(source)) return [];
  const currentKeys = new Set(source.requirements.map((requirement) =>
    `${source.understandingId}:${requirement.id}`));
  return workspace.requirements.filter((requirement) =>
    requirement.sourceRequirementKey !== null && currentKeys.has(requirement.sourceRequirementKey));
}

export function bidInputProgress(workspace: WorkflowWorkspace) {
  const source = workspace.sourceRequirements;
  const currentRequirements = currentBidInputRequirements(workspace);
  const questions = selectBidRequirementQuestions(currentRequirements);
  const requiredQuestions = questions.filter((question) => question.isRequired);
  const inputsPrepared = Boolean(
    isSolicitationRequirementSetDraftable(source) &&
    source.requirements.length > 0 &&
    currentRequirements.length === source.requirements.length,
  );

  return {
    inputsPrepared,
    questions,
    requiredQuestionCount: requiredQuestions.length,
    answeredRequiredQuestionCount: requiredQuestions.filter((question) =>
      Boolean(question.responseNotes?.trim())).length,
  };
}

export function deriveBidWorkflowStatusForWorkspace(workspace: WorkflowWorkspace) {
  const progress = bidInputProgress(workspace);
  const fullBid = workspace.sections.find((section) => section.metadata.fullBid === true) ?? null;
  return deriveBidWorkflowStatus({
    inputsPrepared: progress.inputsPrepared,
    requiredQuestionCount: progress.requiredQuestionCount,
    answeredRequiredQuestionCount: progress.answeredRequiredQuestionCount,
    hasCurrentDraft: Boolean(fullBid?.content?.trim()),
    readyForFinalApproval: workspace.finalReview.readyForHumanReview,
    approvalCurrent: workspace.finalReviewApprovalCurrent,
    submissionCurrent: Boolean(workspace.currentSubmission),
  });
}
