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
  const text = requirement.text.toLocaleLowerCase("en-US");
  if (/\b(?:authorized|approved)\s+(?:dealer|distributor|reseller)\b/.test(text) ||
      /\bmanufacturer(?:'s)?\s+(?:authorization|authorisation)\b/.test(text)) {
    return "Can you or your supplier provide the required manufacturer authorization or authorized reseller/distributor status? State exactly what proof can be included with the bid.";
  }
  if (/\b(?:warranty|warranties|dead on arrival|\bdoa\b|defective|return|replacement)\b/.test(text)) {
    return "What warranty, DOA/defective-item replacement, and return support can you or the manufacturer commit to for this requirement? State only the exact terms and timelines you can support.";
  }
  if (/\b(?:fob|freight|inside delivery|delivery window|after receipt of order|\baro\b|shipping|loading dock)\b/.test(text)) {
    return "What exact delivery and freight commitment can you or your supplier make for this requirement? Include the supported lead time and any required FOB, inside-delivery, freight, or receiving terms stated by the buyer.";
  }
  if (/\b(?:mwbe|mwdbe|mbe|wbe|sbe|hub|local vendor preference|lvp)\b/.test(text)) {
    return "Does the bidder or an identified subcontractor hold the certification or local-preference status requested here? Provide the exact program, holder, certification/status details, and supporting proof you can include.";
  }
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
