import { generateBidComplianceMatrix } from "@/lib/bids/compliance-persistence";
import { isComplianceEvidence } from "@/lib/bids/compliance";
import { isSolicitationRequirementSetDraftable } from "@/lib/procurement/requirements/readiness";
import type { BidWorkspaceRecord, BidWorkspaceRequirement } from "@/lib/bids/workspace";
import {
  questionForBidRequirement,
  requirementNeedsBidderQuestion,
  selectBidRequirementAssumptions,
  selectBidRequirementQuestions,
  type BidRequirementAssumption,
  type BidRequirementQuestion,
} from "@/lib/bids/requirement-question-rules";

export {
  questionForBidRequirement,
  requirementNeedsBidderQuestion,
  selectBidRequirementAssumptions,
  selectBidRequirementQuestions,
};
export type { BidRequirementAssumption, BidRequirementQuestion };

export function isCurrentBidRequirement(
  requirement: BidWorkspaceRequirement,
  workspace: Pick<BidWorkspaceRecord, "sourceRequirements" | "sourceSnapshot">,
) {
  const evidence = isComplianceEvidence(requirement.evidence) ? requirement.evidence : null;
  return Boolean(
    evidence &&
    workspace.sourceRequirements &&
    !workspace.sourceRequirements.isStale &&
    evidence.understandingId === workspace.sourceRequirements.understandingId &&
    evidence.pursuitSnapshotId === workspace.sourceSnapshot.pursuitSnapshotId,
  );
}

function currentBidRequirements(workspace: BidWorkspaceRecord) {
  if (!isSolicitationRequirementSetDraftable(workspace.sourceRequirements)) return [];
  return workspace.requirements.filter((requirement) => isCurrentBidRequirement(requirement, workspace));
}

export function listBidRequirementQuestions(workspace: BidWorkspaceRecord): BidRequirementQuestion[] {
  return selectBidRequirementQuestions(currentBidRequirements(workspace));
}

export function listBidRequirementAssumptions(workspace: BidWorkspaceRecord): BidRequirementAssumption[] {
  return selectBidRequirementAssumptions(currentBidRequirements(workspace));
}

/**
 * Explicit deterministic user action. Materializes persisted source requirements into
 * bid requirement rows and derives questions without invoking a model.
 */
export async function generateBidRequirementQuestions(workspaceId: string) {
  return generateBidComplianceMatrix(workspaceId);
}
