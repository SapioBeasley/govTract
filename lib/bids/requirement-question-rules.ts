import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

export const BID_RESPONSE_SOURCE_TYPES = [
  "self",
  "subcontractor",
  "manufacturer",
  "other",
] as const;

export type BidResponseSourceType = (typeof BID_RESPONSE_SOURCE_TYPES)[number];

export type BidQuestionCandidate = Pick<BidWorkspaceRequirement, "requirementType"> &
  Partial<Pick<BidWorkspaceRequirement, "text" | "isRequired">>;

export type BidRequirementQuestion = BidWorkspaceRequirement & {
  question: string;
};

export type BidRequirementAssumption = BidWorkspaceRequirement & {
  assumption: string;
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

const inferableScopeTypes = new Set([
  "scope",
  "deliverable",
  "work",
  "quantity",
]);

const bidderCredentialTypes = new Set([
  "qualification",
  "license",
  "certification",
  "insurance",
  "bonding",
  "insurance_bonding",
]);

const choicePattern = /\b(?:alternate|alternative|substitut(?:e|ion)|option(?:al)?|partial\s+bid|line\s+item\s+choice|brand\s+name\s+or\s+equal|or\s+equal|make\s*(?:\/|and)?\s*model|manufacturer\s*(?:\/|and)?\s*model|identify\s+(?:the\s+)?(?:make|model|manufacturer|product))\b/i;
const exceptionPattern = /\b(?:exception|deviation|take\s+exception|variance|non[- ]?compliance|does\s+not\s+meet)\b/i;
const deliveryPattern = /\b(?:delivery|lead\s*time|after\s+receipt\s+of\s+order|\baro\b|ship(?:ping)?|freight|fob|inside\s+delivery|loading\s+dock|receiv(?:e|ing))\b/i;
const manufacturerAuthorizationPattern = /\b(?:authorized|approved)\s+(?:dealer|distributor|reseller)\b|\bmanufacturer(?:'s)?\s+(?:authorization|authorisation)\b/i;
const reusableManufacturerFactPattern = /\b(?:warranty|warranties|dead\s+on\s+arrival|\bdoa\b|defective|return\s+policy|replacement|manufacturer\s+certification|factory\s+certification)\b/i;

export function requirementNeedsBidderQuestion(requirement: BidQuestionCandidate) {
  if (packageOnlyTypes.has(requirement.requirementType)) return false;

  const text = requirement.text?.trim() ?? "";
  const isRequired = requirement.isRequired ?? true;
  if (requirement.requirementType === "pricing") return true;
  if (bidderCredentialTypes.has(requirement.requirementType)) return true;
  if (["schedule", "mandatory_event"].includes(requirement.requirementType)) return true;
  if (deliveryPattern.test(text)) return true;
  if (manufacturerAuthorizationPattern.test(text) || reusableManufacturerFactPattern.test(text)) return true;
  if (choicePattern.test(text) || exceptionPattern.test(text)) return true;

  if (inferableScopeTypes.has(requirement.requirementType)) {
    return !isRequired;
  }

  // Unknown bidder-facing requirement types remain fail-closed: ask for a fact
  // rather than silently assuming a response that the deterministic rules do not understand.
  return true;
}

export function inferredBidAssumptionForRequirement(requirement: BidQuestionCandidate) {
  if ((requirement.isRequired ?? true) !== true || !inferableScopeTypes.has(requirement.requirementType) ||
      requirementNeedsBidderQuestion(requirement)) {
    return null;
  }
  return "Included in the bid by default because the solicitation requires it.";
}

function reusableManufacturerFactKind(text: string) {
  if (manufacturerAuthorizationPattern.test(text)) return "manufacturer_authorization";
  if (/\b(?:warranty|warranties)\b/i.test(text)) return "manufacturer_warranty";
  if (/\b(?:dead\s+on\s+arrival|\bdoa\b|defective|return\s+policy|replacement)\b/i.test(text)) {
    return "manufacturer_return_support";
  }
  if (/\b(?:manufacturer\s+certification|factory\s+certification)\b/i.test(text)) {
    return "manufacturer_certification";
  }
  return null;
}

function normalizedReusableFactText(text: string) {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/^\s*(?:line\s+item|item)\s*(?:no\.?|#)?\s*[a-z0-9.-]+\s*[:\-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function bidQuestionDeduplicationKey(requirement: BidQuestionCandidate) {
  const text = requirement.text ?? "";
  const kind = reusableManufacturerFactKind(text);
  if (!kind) return null;
  return `${kind}:${normalizedReusableFactText(text)}`;
}

export function selectBidRequirementQuestions<T extends BidWorkspaceRequirement>(requirements: T[]) {
  const seenReusableFacts = new Set<string>();
  return requirements.flatMap((requirement): Array<T & { question: string }> => {
    if (!requirementNeedsBidderQuestion(requirement)) return [];
    const dedupeKey = bidQuestionDeduplicationKey(requirement);
    if (dedupeKey) {
      if (seenReusableFacts.has(dedupeKey)) return [];
      seenReusableFacts.add(dedupeKey);
    }
    return [{ ...requirement, question: questionForBidRequirement(requirement) }];
  });
}

export function selectBidRequirementAssumptions<T extends BidWorkspaceRequirement>(requirements: T[]) {
  return requirements.flatMap((requirement): Array<T & { assumption: string }> => {
    const assumption = inferredBidAssumptionForRequirement(requirement);
    return assumption ? [{ ...requirement, assumption }] : [];
  });
}

export function questionForBidRequirement(
  requirement: BidQuestionCandidate,
) {
  const type = requirement.requirementType;
  const text = requirement.text?.toLocaleLowerCase("en-US") ?? "";
  if (manufacturerAuthorizationPattern.test(text)) {
    return "What manufacturer authorization or authorized reseller/distributor proof can support this bid? State the exact status and evidence available.";
  }
  if (reusableManufacturerFactPattern.test(text)) {
    return "What manufacturer-backed warranty, replacement/return, or certification fact applies here? State only the exact terms and evidence that can support the bid.";
  }
  if (deliveryPattern.test(text)) {
    return "What exact delivery and freight commitment will the bidder make for this requirement? Include the supported lead time and any required FOB, inside-delivery, freight, or receiving terms stated by the buyer.";
  }
  if (/\b(?:mwbe|mwdbe|mbe|wbe|sbe|hub|local vendor preference|lvp)\b/.test(text)) {
    return "Does the bidder or an identified subcontractor hold the certification or local-preference status requested here? Provide the exact program, holder, certification/status details, and supporting proof that can be included.";
  }
  if (type === "pricing") {
    return "What pricing will the bidder offer for this requirement? Include the exact unit price, total, and any required shipping/handling or other pricing components.";
  }
  if (bidderCredentialTypes.has(type)) {
    return "What exact bidder, subcontractor, or manufacturer qualification, certification, license, insurance, or bonding fact satisfies this requirement, and what supporting proof is available?";
  }
  if (["schedule", "mandatory_event"].includes(type)) {
    return "What exact timing or event commitment will the bidder make for this requirement?";
  }
  if (choicePattern.test(text)) {
    return "What option is the bidder offering here? Identify the selected line item, make/model, alternate, substitution, or partial-bid choice and any supporting details required by the buyer.";
  }
  if (exceptionPattern.test(text)) {
    return "Does the bidder take any exception or deviation from this requirement? State the exact exception or confirm that none is being taken.";
  }
  if ((requirement.isRequired ?? true) !== true && inferableScopeTypes.has(type)) {
    return "Will the bidder include this optional or conditional item? If yes, state exactly what is being offered and any requested make/model, quantity, or pricing detail.";
  }
  if (inferableScopeTypes.has(type)) {
    return "What bidder-specific fact is needed to distinguish the offered scope from the buyer's required scope?";
  }
  return "What bidder-specific fact is needed for this requirement?";
}
