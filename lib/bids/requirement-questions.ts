import { generateBidComplianceMatrix } from "@/lib/bids/compliance-persistence";
import { isComplianceEvidence } from "@/lib/bids/compliance";
import type { BidWorkspaceRecord, BidWorkspaceRequirement } from "@/lib/bids/workspace";

export const BID_RESPONSE_SOURCE_TYPES = [
  "self",
  "subcontractor",
  "manufacturer",
  "other",
] as const;

export type BidResponseSourceType = (typeof BID_RESPONSE_SOURCE_TYPES)[number];

export type BidRequirementQuestion = BidWorkspaceRequirement & {
  question: string;
};

export function isBidResponseSourceType(value: unknown): value is BidResponseSourceType {
  return typeof value === "string" &&
    BID_RESPONSE_SOURCE_TYPES.some((source) => source === value);
}

const packageOnlyTypes = new Set([
  "form",
  "submission_instruction",
  "evaluation",
  "disqualifier",
  "deadline",
  "location",
]);

export function requirementNeedsBidderQuestion(
  requirement: Pick<BidWorkspaceRequirement, "requirementType">,
) {
  return !packageOnlyTypes.has(requirement.requirementType);
}

export function questionForBidRequirement(
  requirement: Pick<BidWorkspaceRequirement, "requirementType" | "text">,
) {
  const type = requirement.requirementType;
  if (type === "pricing") {
    return "What pricing will you offer for this requirement? Include the exact unit price, total, and any required shipping/handling or other pricing components you can support.";
  }
  if (["qualification", "license", "certification", "insurance", "bonding", "insurance_bonding"].includes(type)) {
    return "Can you, your subcontractor, or your manufacturer satisfy this requirement? Provide the exact qualification, certification, license, insurance, or bonding details you can support.";
  }
  if (["schedule", "mandatory_event"].includes(type)) {
    return "Can you meet this timing or event requirement? State the exact commitment you can make.";
  }
  if (["scope", "deliverable", "work", "quantity"].includes(type)) {
    return "What will you or your supplier provide to satisfy this requirement? Include make/model, quantity, specifications, or approach where applicable.";
  }
  return "What bidder or supplier response should be used for this requirement?";
}

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
