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

const choicePattern = /\b(?:alternate|alternative|substitut(?:e|ion)|option(?:al)?|partial\s+bid|line\s+item\s+choice|brand\s+name\s+or\s+equal|or\s+equal|make\s*(?:\/|and)?\s*model|manufacturer\s*(?:\/|and)?\s*model|identify\s+(?:the\s+)?(?:make|model|manufacturer|product))\b/i;
const exceptionPattern = /\b(?:exception|deviation|take\s+exception|variance|non[- ]?compliance|does\s+not\s+meet)\b/i;
const deliveryPattern = /\b(?:delivery|lead\s*time|after\s+receipt\s+of\s+order|\baro\b|ship(?:ping)?|freight|fob|inside\s+delivery|loading\s+dock|receiv(?:e|ing))\b/i;
const bidderScheduleInputPattern = /\b(?:state|provide|identify|propose|specify|indicate|submit|enter)\b[^.\n]{0,80}\b(?:schedule|timeline|completion\s+(?:date|time)|lead\s*time|delivery\s+(?:date|time))\b/i;
const mandatoryLanguagePattern = /\b(?:shall|must|required\s+to|is\s+required|are\s+required|will\s+be\s+(?:provided|performed|completed|installed|delivered|planted|applied))\b/i;
const pricedLineItemPattern = /^\s*Supply\s+\d+(?:\.\d+)?\s+.+?\s+of\s+/i;
const manufacturerPattern = /\b(?:manufacturer|factory)\b/i;
const manufacturerAuthorizationPattern = /\b(?:authorized|approved)\s+(?:dealer|distributor|reseller)\b|\bmanufacturer(?:'s)?\s+(?:authorization|authorisation)\b/i;
const warrantyPattern = /\b(?:warranty|warranties)\b/i;
const returnSupportPattern = /\b(?:dead\s+on\s+arrival|\bdoa\b|defective|return\s+policy|replacement|replaces?|replace)\b/i;
const manufacturerCertificationPattern = /\b(?:manufacturer\s+certification|factory\s+certification)\b/i;
const bidderCredentialFactPattern = /\b(?:licen[cs](?:e|ed|ing)|certif(?:ication|ied)|registered|registration|accredit(?:ed|ation)|designation|bond(?:ed|ing)?|years?\s+of\s+experience|minimum\s+[^.\n]{0,40}\s+experience|demonstrat(?:e|es|ed)\s+[^.\n]{0,50}\s+experience)\b/i;
const localPreferenceFactPattern = /\b(?:mwbe|mwdbe|mbe|wbe|sbe|hub|local\s+vendor\s+preference|lvp)\b/i;
const formRepresentationPattern = /\bequal\s+opportunity\s+employer\b/i;

function hasManufacturerFact(text: string) {
  return manufacturerAuthorizationPattern.test(text) ||
    manufacturerCertificationPattern.test(text) ||
    (manufacturerPattern.test(text) && (warrantyPattern.test(text) || returnSupportPattern.test(text)));
}

export function requirementNeedsBidderQuestion(requirement: BidQuestionCandidate) {
  if (packageOnlyTypes.has(requirement.requirementType)) return false;

  const text = requirement.text?.trim() ?? "";
  if (requirement.requirementType === "pricing") return true;
  if (pricedLineItemPattern.test(text)) return true;
  if (formRepresentationPattern.test(text)) return false;
  if (requirement.requirementType === "license" || requirement.requirementType === "certification") return true;
  if (["qualification", "bonding", "insurance_bonding"].includes(requirement.requirementType) &&
      (bidderCredentialFactPattern.test(text) || localPreferenceFactPattern.test(text))) return true;
  if (requirement.requirementType === "insurance") return false;
  if (requirement.requirementType === "mandatory_event") return true;
  if (requirement.requirementType === "schedule") {
    return bidderScheduleInputPattern.test(text) || choicePattern.test(text) || exceptionPattern.test(text);
  }
  if (deliveryPattern.test(text)) return true;
  if (hasManufacturerFact(text)) return true;
  if (choicePattern.test(text) || exceptionPattern.test(text)) return true;

  // Scope, work, deliverables, quantities, ordinary workmanship, and future compliance
  // commitments describe what the buyer wants. They are included by default unless the
  // solicitation asks the bidder for a price, choice, exception, credential, schedule,
  // delivery commitment, or manufacturer-specific fact. `isRequired: false` can mean
  // source-understanding uncertainty and must never be interpreted as "optional" alone.
  if (inferableScopeTypes.has(requirement.requirementType) || requirement.requirementType === "qualification") {
    return false;
  }

  return false;
}

export function inferredBidAssumptionForRequirement(requirement: BidQuestionCandidate) {
  const text = requirement.text?.trim() ?? "";
  const inferableType = inferableScopeTypes.has(requirement.requirementType) ||
    requirement.requirementType === "schedule" ||
    requirement.requirementType === "qualification" ||
    requirement.requirementType === "insurance";
  if (!inferableType || requirementNeedsBidderQuestion(requirement)) return null;
  if ((requirement.isRequired ?? true) !== true && !mandatoryLanguagePattern.test(text) &&
      requirement.requirementType === "schedule") {
    return null;
  }
  return "Included in the bid by default because the solicitation prescribes it; record an exception only if the bid will differ.";
}

function reusableManufacturerFactKind(text: string) {
  if (manufacturerAuthorizationPattern.test(text)) return "manufacturer_authorization";
  if (manufacturerCertificationPattern.test(text)) return "manufacturer_certification";
  if (!manufacturerPattern.test(text)) return null;
  if (warrantyPattern.test(text)) return "manufacturer_warranty";
  if (returnSupportPattern.test(text)) return "manufacturer_return_support";
  return null;
}

const numberWords: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

function warrantyDurationKey(text: string) {
  const normalized = text.toLocaleLowerCase("en-US");
  const numeric = normalized.match(/\b(\d+)\s*[- ]?years?\b/);
  if (numeric?.[1]) return `${numeric[1]}-year`;
  const parenthetical = normalized.match(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*\((\d+)\)\s*[- ]?years?\b/);
  if (parenthetical?.[1]) return `${parenthetical[1]}-year`;
  const word = normalized.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?years?\b/);
  if (word?.[1] && numberWords[word[1]]) return `${numberWords[word[1]]}-year`;
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
  if (kind === "manufacturer_warranty") {
    const duration = warrantyDurationKey(text);
    if (duration) return `${kind}:${duration}`;
  }
  return `${kind}:${normalizedReusableFactText(text)}`;
}

export function selectBidRequirementQuestions<T extends BidWorkspaceRequirement>(requirements: T[]) {
  const output: Array<T & { question: string }> = [];
  const reusableIndexes = new Map<string, number>();

  for (const requirement of requirements) {
    if (!requirementNeedsBidderQuestion(requirement)) continue;
    const candidate = { ...requirement, question: questionForBidRequirement(requirement) };
    const dedupeKey = bidQuestionDeduplicationKey(requirement);
    if (!dedupeKey) {
      output.push(candidate);
      continue;
    }

    const existingIndex = reusableIndexes.get(dedupeKey);
    if (existingIndex === undefined) {
      reusableIndexes.set(dedupeKey, output.length);
      output.push(candidate);
      continue;
    }

    // A saved fact on any equivalent line item satisfies the shared manufacturer-level
    // question. Prefer that row so the user sees the existing answer instead of being
    // asked to re-enter the same warranty/authorization/support fact.
    const existing = output[existingIndex];
    if (!existing.responseNotes?.trim() && requirement.responseNotes?.trim()) {
      output[existingIndex] = candidate;
    }
  }

  return output;
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
  const originalText = requirement.text ?? "";
  const text = originalText.toLocaleLowerCase("en-US");
  if (pricedLineItemPattern.test(originalText)) {
    return "What price will the bidder offer for this line item? Include the unit price and extended total, plus any required freight or other pricing component.";
  }
  if (manufacturerAuthorizationPattern.test(text)) {
    return "What manufacturer authorization or authorized reseller/distributor proof can support this bid? State the exact status and evidence available.";
  }
  if (manufacturerPattern.test(text) && warrantyPattern.test(text) && returnSupportPattern.test(text)) {
    return "What exact manufacturer warranty and DOA/replacement or return support applies here? State only the supported terms and evidence available for the bid.";
  }
  if (manufacturerPattern.test(text) && warrantyPattern.test(text)) {
    return "What exact manufacturer warranty applies here? State only the supported term, coverage, and evidence available for the bid.";
  }
  if (manufacturerPattern.test(text) && returnSupportPattern.test(text)) {
    return "What exact manufacturer DOA, replacement, defective-item, or return support applies here? State only the supported terms and evidence available for the bid.";
  }
  if (manufacturerCertificationPattern.test(text)) {
    return "What exact manufacturer or factory certification applies here, and what supporting evidence is available for the bid?";
  }
  if (deliveryPattern.test(text)) {
    return "What exact delivery and freight commitment will the bidder make for this requirement? Include the supported lead time and any required FOB, inside-delivery, freight, or receiving terms stated by the buyer.";
  }
  if (localPreferenceFactPattern.test(text)) {
    return "Does the bidder or an identified subcontractor hold the certification or local-preference status requested here? Provide the exact program, holder, certification/status details, and supporting proof that can be included.";
  }
  if (type === "pricing") {
    return "What pricing will the bidder offer for this requirement? Include the exact unit price, total, and any required shipping/handling or other pricing components.";
  }
  if (type === "license") {
    return "What exact current license satisfies this requirement? Provide the license type, holder, number if appropriate for the bid, and supporting proof available.";
  }
  if (type === "certification") {
    return "What exact current certification satisfies this requirement? Provide the certification, holder, and supporting proof available.";
  }
  if (["qualification", "bonding", "insurance_bonding"].includes(type) && bidderCredentialFactPattern.test(text)) {
    return "What exact bidder qualification or credential satisfies this requirement, and what supporting proof is available?";
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
  return "What bidder-specific fact is needed for this requirement?";
}
