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
const bidderScheduleInputPattern = /\b(?:state|provide|identify|propose|specify|indicate|submit|enter)\b[^.\n]{0,80}\b(?:schedule|timeline|completion\s+(?:date|time)|lead\s*time|delivery\s+(?:date|time))\b/i;
const mandatoryLanguagePattern = /\b(?:shall|must|required\s+to|is\s+required|are\s+required|will\s+be\s+(?:provided|performed|completed|installed|delivered|planted|applied))\b/i;
const manufacturerAuthorizationPattern = /\b(?:authorized|approved)\s+(?:dealer|distributor|reseller)\b|\bmanufacturer(?:'s)?\s+(?:authorization|authorisation)\b/i;
const warrantyPattern = /\b(?:warranty|warranties)\b/i;
const returnSupportPattern = /\b(?:dead\s+on\s+arrival|\bdoa\b|defective|return\s+policy|replacement|replaces?|replace)\b/i;
const manufacturerCertificationPattern = /\b(?:manufacturer\s+certification|factory\s+certification)\b/i;
const reusableManufacturerFactPattern = new RegExp(
  `${warrantyPattern.source}|${returnSupportPattern.source}|${manufacturerCertificationPattern.source}`,
  "i",
);

export function requirementNeedsBidderQuestion(requirement: BidQuestionCandidate) {
  if (packageOnlyTypes.has(requirement.requirementType)) return false;

  const text = requirement.text?.trim() ?? "";
  if (requirement.requirementType === "pricing") return true;
  if (bidderCredentialTypes.has(requirement.requirementType)) return true;
  if (requirement.requirementType === "mandatory_event") return true;
  if (requirement.requirementType === "schedule") {
    return bidderScheduleInputPattern.test(text) || choicePattern.test(text) || exceptionPattern.test(text);
  }
  if (deliveryPattern.test(text)) return true;
  if (manufacturerAuthorizationPattern.test(text) || reusableManufacturerFactPattern.test(text)) return true;
  if (choicePattern.test(text) || exceptionPattern.test(text)) return true;

  // Scope, work, deliverables, and quantities describe what the buyer wants. They are
  // included by default unless the solicitation explicitly asks the bidder to choose,
  // identify, substitute, or take an exception. `isRequired: false` can mean the source
  // understanding was uncertain; it must not be interpreted as "optional" by itself.
  if (inferableScopeTypes.has(requirement.requirementType)) return false;

  return true;
}

export function inferredBidAssumptionForRequirement(requirement: BidQuestionCandidate) {
  const text = requirement.text?.trim() ?? "";
  const inferableType = inferableScopeTypes.has(requirement.requirementType) ||
    requirement.requirementType === "schedule";
  if (!inferableType || requirementNeedsBidderQuestion(requirement)) return null;
  if ((requirement.isRequired ?? true) !== true && !mandatoryLanguagePattern.test(text) &&
      requirement.requirementType === "schedule") {
    return null;
  }
  return "Included in the bid by default because the solicitation prescribes it; record an exception only if the bid will differ.";
}

function reusableManufacturerFactKind(text: string) {
  if (manufacturerAuthorizationPattern.test(text)) return "manufacturer_authorization";
  if (warrantyPattern.test(text)) return "manufacturer_warranty";
  if (returnSupportPattern.test(text)) return "manufacturer_return_support";
  if (manufacturerCertificationPattern.test(text)) return "manufacturer_certification";
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
  const text = requirement.text?.toLocaleLowerCase("en-US") ?? "";
  if (manufacturerAuthorizationPattern.test(text)) {
    return "What manufacturer authorization or authorized reseller/distributor proof can support this bid? State the exact status and evidence available.";
  }
  if (warrantyPattern.test(text) && returnSupportPattern.test(text)) {
    return "What exact manufacturer warranty and DOA/replacement or return support applies here? State only the supported terms and evidence available for the bid.";
  }
  if (warrantyPattern.test(text)) {
    return "What exact manufacturer warranty applies here? State only the supported term, coverage, and evidence available for the bid.";
  }
  if (returnSupportPattern.test(text)) {
    return "What exact manufacturer DOA, replacement, defective-item, or return support applies here? State only the supported terms and evidence available for the bid.";
  }
  if (manufacturerCertificationPattern.test(text)) {
    return "What exact manufacturer or factory certification applies here, and what supporting evidence is available for the bid?";
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
  if (inferableScopeTypes.has(type)) {
    return "What bidder-specific fact is needed to distinguish the offered scope from the buyer's required scope?";
  }
  return "What bidder-specific fact is needed for this requirement?";
}
