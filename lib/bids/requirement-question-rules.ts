import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

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
