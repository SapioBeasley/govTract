import { generateBidComplianceMatrix } from "@/lib/bids/compliance-persistence";
import { isComplianceEvidence } from "@/lib/bids/compliance";
import { isSolicitationRequirementSetDraftable } from "@/lib/procurement/requirements/readiness";
import type { BidWorkspaceRecord, BidWorkspaceRequirement } from "@/lib/bids/workspace";
import {
  questionForBidRequirement,
  requirementNeedsBidderQuestion,
  type BidRequirementQuestion,
} from "@/lib/bids/requirement-question-rules";

export { questionForBidRequirement, requirementNeedsBidderQuestion };
export type { BidRequirementQuestion };

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

export function listBidRequirementQuestions(workspace: BidWorkspaceRecord): BidRequirementQuestion[] {
  if (!isSolicitationRequirementSetDraftable(workspace.sourceRequirements)) return [];
  return workspace.requirements
    .filter((requirement) => isCurrentBidRequirement(requirement, workspace))
    .filter(requirementNeedsBidderQuestion)
    .map((requirement) => ({
      ...requirement,
      question: questionForBidRequirement(requirement),
    }));
}

/**
 * Explicit deterministic user action. Materializes persisted source requirements into
 * bid requirement rows and derives questions without invoking a model.
 */
export async function generateBidRequirementQuestions(workspaceId: string) {
  return generateBidComplianceMatrix(workspaceId);
}
