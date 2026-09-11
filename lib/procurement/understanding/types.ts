export const SOLICITATION_UNDERSTANDING_SCHEMA_VERSION = "1" as const;

export const solicitationUnderstandingSectionKeys = [
  "summary",
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
  "questionsAmbiguities",
] as const;

const findingSectionKeys = [
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
  "questionsAmbiguities",
] as const;

export type SolicitationUnderstandingSectionKey =
  (typeof solicitationUnderstandingSectionKeys)[number];

export type SolicitationUnderstandingFinding = {
  key: string;
  text: string;
  details?: Record<string, unknown>;
};

export type SolicitationUnderstandingContent = {
  summary: string;
  scope: SolicitationUnderstandingFinding[];
  deliverables: SolicitationUnderstandingFinding[];
  workBreakdown: SolicitationUnderstandingFinding[];
  location: SolicitationUnderstandingFinding[];
  schedule: SolicitationUnderstandingFinding[];
  quantities: SolicitationUnderstandingFinding[];
  qualifications: SolicitationUnderstandingFinding[];
  insuranceBonding: SolicitationUnderstandingFinding[];
  mandatoryEvents: SolicitationUnderstandingFinding[];
  pricingInstructions: SolicitationUnderstandingFinding[];
  submissionComponents: SolicitationUnderstandingFinding[];
  evaluationCriteria: SolicitationUnderstandingFinding[];
  disqualifiers: SolicitationUnderstandingFinding[];
  questionsAmbiguities: SolicitationUnderstandingFinding[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinding(value: unknown): value is SolicitationUnderstandingFinding {
  if (!isRecord(value)) return false;
  if (typeof value.key !== "string" || value.key.trim().length === 0) return false;
  if (typeof value.text !== "string" || value.text.trim().length === 0) return false;
  if (value.details !== undefined && !isRecord(value.details)) return false;
  return true;
}

export function isSolicitationUnderstandingContent(
  value: unknown,
): value is SolicitationUnderstandingContent {
  if (!isRecord(value)) return false;
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) return false;

  for (const key of findingSectionKeys) {
    const section = value[key];
    if (!Array.isArray(section) || !section.every(isFinding)) return false;
  }

  return true;
}
