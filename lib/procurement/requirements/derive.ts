import type {
  SolicitationUnderstandingContent,
  SolicitationUnderstandingFinding,
} from "../understanding/types";

export const solicitationRequirementTypes = [
  "scope",
  "deliverable",
  "work",
  "location",
  "deadline",
  "schedule",
  "quantity",
  "qualification",
  "license",
  "certification",
  "insurance",
  "bonding",
  "insurance_bonding",
  "mandatory_event",
  "pricing",
  "form",
  "submission_instruction",
  "evaluation",
  "disqualifier",
] as const;

export const solicitationRequirementLevels = ["required", "optional", "unknown"] as const;

export type SolicitationRequirementType = (typeof solicitationRequirementTypes)[number];
export type SolicitationRequirementLevel = (typeof solicitationRequirementLevels)[number];

export type SolicitationRequirementSourceSection =
  | "scope"
  | "deliverables"
  | "workBreakdown"
  | "location"
  | "schedule"
  | "quantities"
  | "qualifications"
  | "insuranceBonding"
  | "mandatoryEvents"
  | "pricingInstructions"
  | "submissionComponents"
  | "evaluationCriteria"
  | "disqualifiers";

export type DerivedSolicitationRequirement = {
  requirementKey: string;
  type: SolicitationRequirementType;
  level: SolicitationRequirementLevel;
  text: string;
  sourceSection: SolicitationRequirementSourceSection;
  sourceFindingKey: string;
  details: Record<string, unknown>;
};

const requirementSections: readonly SolicitationRequirementSourceSection[] = [
  "scope",
  "deliverables",
  "workBreakdown",
  "location",
  "schedule",
  "quantities",
  "qualifications",
  "insuranceBonding",
  "mandatoryEvents",
  "pricingInstructions",
  "submissionComponents",
  "evaluationCriteria",
  "disqualifiers",
];

const sectionDefaultsToRequired = new Set<SolicitationRequirementSourceSection>([
  "pricingInstructions",
  "submissionComponents",
  "disqualifiers",
]);

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function explicitRequired(details: Record<string, unknown> | undefined) {
  if (!details) return null;
  if (typeof details.required === "boolean") return details.required;
  if (typeof details.optional === "boolean") return !details.optional;
  return null;
}

function classifyLevel(
  section: SolicitationRequirementSourceSection,
  finding: SolicitationUnderstandingFinding,
): SolicitationRequirementLevel {
  const explicit = explicitRequired(finding.details);
  if (explicit === true) return "required";
  if (explicit === false) return "optional";

  const text = normalizeText(finding.text);
  if (
    /\b(optional|recommended|encouraged|voluntary)\b/.test(text) ||
    /\bnot\s+(?:required|mandatory)\b/.test(text)
  ) {
    return "optional";
  }
  if (sectionDefaultsToRequired.has(section)) return "required";
  if (
    /\b(must|shall|required|mandatory)\b/.test(text) ||
    /\bwill be rejected\b/.test(text) ||
    /\bis required\b/.test(text) ||
    /\bare required\b/.test(text)
  ) {
    return "required";
  }
  return "unknown";
}

function classifyType(
  section: SolicitationRequirementSourceSection,
  finding: SolicitationUnderstandingFinding,
): SolicitationRequirementType {
  const text = normalizeText(finding.text);

  switch (section) {
    case "scope":
      return "scope";
    case "deliverables":
      return "deliverable";
    case "workBreakdown":
      return "work";
    case "location":
      return "location";
    case "schedule":
      return /\b(due|deadline|submit(?:ted)? by|no later than|closing date|bid opening)\b/.test(text)
        ? "deadline"
        : "schedule";
    case "quantities":
      return "quantity";
    case "qualifications":
      if (/\blicen[cs](?:e|ed|es|ing)\b/.test(text)) return "license";
      if (/\bcertif(?:y|ied|ication|ications)\b/.test(text)) return "certification";
      return "qualification";
    case "insuranceBonding": {
      const hasInsurance = /\binsurance\b/.test(text);
      const hasBond = /\bbond(?:ing|s)?\b/.test(text);
      if (hasInsurance && hasBond) return "insurance_bonding";
      if (hasBond) return "bonding";
      if (hasInsurance) return "insurance";
      return "insurance_bonding";
    }
    case "mandatoryEvents":
      return "mandatory_event";
    case "pricingInstructions":
      return "pricing";
    case "submissionComponents":
      if (/\bcertif(?:y|ied|ication|ications)\b/.test(text)) return "certification";
      if (/\b(form|affidavit|attachment|schedule|worksheet|sheet)\b/.test(text)) return "form";
      return "submission_instruction";
    case "evaluationCriteria":
      return "evaluation";
    case "disqualifiers":
      return "disqualifier";
  }
}

export function deriveSolicitationRequirements(
  content: SolicitationUnderstandingContent,
): DerivedSolicitationRequirement[] {
  const requirements: DerivedSolicitationRequirement[] = [];

  for (const section of requirementSections) {
    const findings = content[section];
    for (const finding of findings) {
      requirements.push({
        requirementKey: `${section}:${finding.key}`,
        type: classifyType(section, finding),
        level: classifyLevel(section, finding),
        text: finding.text.trim(),
        sourceSection: section,
        sourceFindingKey: finding.key,
        details: finding.details ?? {},
      });
    }
  }

  return requirements;
}
