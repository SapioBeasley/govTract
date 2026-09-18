import { createHash } from "node:crypto";

import type {
  PersistedSolicitationRequirement,
  SolicitationRequirementSet,
} from "@/lib/procurement/requirements/persistence";

export const EVALUATION_RULE_VERSION = "go-no-go-v1" as const;

export const opportunityAssessmentStates = ["go", "conditional", "no_go"] as const;
export type OpportunityAssessmentState = (typeof opportunityAssessmentStates)[number];

export const opportunityEvaluationFactorStatuses = ["pass", "risk", "blocker", "unknown"] as const;
export type OpportunityEvaluationFactorStatus =
  (typeof opportunityEvaluationFactorStatuses)[number];

export const opportunityEvaluationFactorKinds = [
  "deadline",
  "scope_fit",
  "naics_fit",
  "geography",
  "contract_value",
  "qualification",
  "certification",
  "license",
  "insurance_bonding",
  "mandatory_event",
  "disqualifier",
  "submission_complexity",
] as const;
export type OpportunityEvaluationFactorKind =
  (typeof opportunityEvaluationFactorKinds)[number];

export type OpportunityEvaluationEvidence = {
  opportunityDocumentVersionId: string;
  documentExtractionSegmentId: string | null;
  locator: Record<string, unknown>;
  excerpt: string | null;
};

export type OpportunityEvaluationFactor = {
  key: string;
  kind: OpportunityEvaluationFactorKind;
  status: OpportunityEvaluationFactorStatus;
  requirementLevel?: "required" | "optional" | "unknown";
  summary: string;
  requirementKey?: string;
  evidence: OpportunityEvaluationEvidence[];
};

export type OpportunityEvaluationProfileInput = {
  productsServices: string[];
  capabilities: string[];
  preferredIndustries: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  serviceAreas: string[];
  preferredContractMin: number | null;
  preferredContractMax: number | null;
  naicsCodes: string[];
  certifications: string[];
  statuses: string[];
  licenses: string[];
  governmentRegistrations: string[];
  pastPerformance: string[];
};

export type OpportunityEvaluationInput = {
  now: Date;
  profile: OpportunityEvaluationProfileInput;
  opportunity: {
    dueAt: Date | null;
    location: Record<string, unknown>;
    classifications: Array<{
      scheme: string;
      code: string | null;
      name: string;
    }>;
  };
  requirements: SolicitationRequirementSet | null;
};

export type OpportunityEvaluationResult = {
  ruleVersion: typeof EVALUATION_RULE_VERSION;
  inputFingerprint: string;
  assessment: OpportunityAssessmentState;
  factors: OpportunityEvaluationFactor[];
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function candidateMatchesText(candidate: string, text: string) {
  const normalizedCandidate = normalize(candidate);
  const normalizedText = normalize(text);
  if (!normalizedCandidate || !normalizedText) return false;
  if (normalizedText.includes(normalizedCandidate)) return true;

  const tokens = normalizedCandidate.split(" ").filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function anyCandidateMatches(candidates: string[], texts: string[]) {
  return candidates.some((candidate) => texts.some((text) => candidateMatchesText(candidate, text)));
}

function evidenceOf(requirement: PersistedSolicitationRequirement): OpportunityEvaluationEvidence[] {
  return requirement.evidence.map((evidence) => ({
    opportunityDocumentVersionId: evidence.opportunityDocumentVersionId,
    documentExtractionSegmentId: evidence.documentExtractionSegmentId,
    locator: evidence.locator,
    excerpt: evidence.excerpt,
  }));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function fingerprint(input: OpportunityEvaluationInput) {
  const stable = {
    ruleVersion: EVALUATION_RULE_VERSION,
    profile: input.profile,
    opportunity: {
      dueAt: input.opportunity.dueAt?.toISOString() ?? null,
      location: input.opportunity.location,
      classifications: input.opportunity.classifications,
    },
    requirements: input.requirements,
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(stable))).digest("hex");
}

function deadlineFactor(input: OpportunityEvaluationInput): OpportunityEvaluationFactor {
  const dueAt = input.opportunity.dueAt;
  if (!dueAt) {
    return {
      key: "deadline",
      kind: "deadline",
      status: "unknown",
      summary: "The response deadline is not available in normalized opportunity data.",
      evidence: [],
    };
  }
  if (dueAt.getTime() <= input.now.getTime()) {
    return {
      key: "deadline",
      kind: "deadline",
      status: "blocker",
      summary: `The response deadline passed on ${dueAt.toISOString()}.`,
      evidence: [],
    };
  }
  return {
    key: "deadline",
    kind: "deadline",
    status: "pass",
    summary: `The response deadline is still open through ${dueAt.toISOString()}.`,
    evidence: [],
  };
}

function scopeFactors(input: OpportunityEvaluationInput): OpportunityEvaluationFactor[] {
  const requirements =
    input.requirements?.requirements.filter((requirement) =>
      ["scope", "work", "deliverable"].includes(requirement.type),
    ) ?? [];
  if (requirements.length === 0) {
    return [
      {
        key: "scope-fit",
        kind: "scope_fit",
        status: "unknown",
        summary: "No structured scope requirements are available to compare with the company profile.",
        evidence: [],
      },
    ];
  }

  const requirementTexts = requirements.map((requirement) => requirement.text);
  const positiveCandidates = [
    ...input.profile.productsServices,
    ...input.profile.capabilities,
    ...input.profile.preferredIndustries,
    ...input.profile.preferredKeywords,
  ];

  const factors: OpportunityEvaluationFactor[] = [];
  factors.push({
    key: "scope-fit",
    kind: "scope_fit",
    status: anyCandidateMatches(positiveCandidates, requirementTexts) ? "pass" : "unknown",
    summary: anyCandidateMatches(positiveCandidates, requirementTexts)
      ? "The solicitation scope has deterministic term overlap with the company profile."
      : "The deterministic rules cannot confirm scope fit from the available profile terms.",
    evidence: requirements.flatMap(evidenceOf),
  });

  const excluded = input.profile.excludedKeywords.filter((keyword) =>
    requirementTexts.some((text) => candidateMatchesText(keyword, text)),
  );
  if (excluded.length > 0) {
    factors.push({
      key: "scope-exclusions",
      kind: "scope_fit",
      status: "risk",
      summary: `The scope contains excluded or avoid terms from the company profile: ${excluded.join(", ")}.`,
      evidence: requirements.flatMap(evidenceOf),
    });
  }
  return factors;
}

function naicsFactor(input: OpportunityEvaluationInput): OpportunityEvaluationFactor {
  const opportunityNaics = input.opportunity.classifications
    .filter((classification) => classification.scheme.toUpperCase() === "NAICS")
    .map((classification) => classification.code)
    .filter((code): code is string => Boolean(code));
  if (opportunityNaics.length === 0 || input.profile.naicsCodes.length === 0) {
    return {
      key: "naics-fit",
      kind: "naics_fit",
      status: "unknown",
      summary: "NAICS fit cannot be confirmed because one side has no NAICS codes.",
      evidence: [],
    };
  }
  const matches = opportunityNaics.filter((code) =>
    input.profile.naicsCodes.some(
      (profileCode) => code === profileCode || code.startsWith(profileCode) || profileCode.startsWith(code),
    ),
  );
  return {
    key: "naics-fit",
    kind: "naics_fit",
    status: matches.length > 0 ? "pass" : "risk",
    summary:
      matches.length > 0
        ? `Opportunity NAICS matches the company profile: ${matches.join(", ")}.`
        : `Opportunity NAICS (${opportunityNaics.join(", ")}) does not match the profile NAICS list.`,
    evidence: [],
  };
}

function geographyFactor(input: OpportunityEvaluationInput): OpportunityEvaluationFactor {
  const locationValues = Object.values(input.opportunity.location).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (locationValues.length === 0 || input.profile.serviceAreas.length === 0) {
    return {
      key: "geography",
      kind: "geography",
      status: "unknown",
      summary: "Geographic fit cannot be confirmed because location or service-area data is missing.",
      evidence: [],
    };
  }
  const matched = input.profile.serviceAreas.filter((area) =>
    locationValues.some(
      (location) => candidateMatchesText(area, location) || candidateMatchesText(location, area),
    ),
  );
  return {
    key: "geography",
    kind: "geography",
    status: matched.length > 0 ? "pass" : "risk",
    summary:
      matched.length > 0
        ? `Opportunity location overlaps the stated service area: ${matched.join(", ")}.`
        : "Opportunity location does not deterministically overlap the stated service area.",
    evidence: [],
  };
}

function comparableProfileFacts(
  kind: OpportunityEvaluationFactorKind,
  profile: OpportunityEvaluationProfileInput,
) {
  switch (kind) {
    case "certification":
      return [...profile.certifications, ...profile.statuses, ...profile.governmentRegistrations];
    case "license":
      return profile.licenses;
    case "qualification":
      return [
        ...profile.capabilities,
        ...profile.pastPerformance,
        ...profile.certifications,
        ...profile.statuses,
        ...profile.licenses,
      ];
    default:
      return [];
  }
}

function requirementKind(requirement: PersistedSolicitationRequirement): OpportunityEvaluationFactorKind | null {
  switch (requirement.type) {
    case "qualification":
      return "qualification";
    case "certification":
      return "certification";
    case "license":
      return "license";
    case "insurance":
    case "bonding":
    case "insurance_bonding":
      return "insurance_bonding";
    case "mandatory_event":
      return "mandatory_event";
    case "disqualifier":
      return "disqualifier";
    default:
      return null;
  }
}

function mandatoryRequirementFactors(input: OpportunityEvaluationInput): OpportunityEvaluationFactor[] {
  if (!input.requirements) {
    return [
      {
        key: "requirements-unavailable",
        kind: "qualification",
        status: "unknown",
        requirementLevel: "required",
        summary: "Structured solicitation requirements are not available.",
        evidence: [],
      },
    ];
  }

  return input.requirements.requirements.flatMap((requirement) => {
    const kind = requirementKind(requirement);
    if (!kind) return [];

    const facts = comparableProfileFacts(kind, input.profile);
    const matched =
      facts.length > 0 && facts.some((fact) => candidateMatchesText(fact, requirement.text));

    return [
      {
        key: `requirement:${requirement.requirementKey}`,
        kind,
        status: matched ? "pass" : "unknown",
        requirementLevel:
          requirement.level === "required" || requirement.level === "optional"
            ? requirement.level
            : "unknown",
        summary: matched
          ? "The company profile contains a fact that directly matches this solicitation requirement."
          : requirement.level === "required"
            ? "This required item is not confirmed by the company profile and needs review."
            : "This item is not confirmed by the company profile.",
        requirementKey: requirement.requirementKey,
        evidence: evidenceOf(requirement),
      } satisfies OpportunityEvaluationFactor,
    ];
  });
}

function submissionComplexityFactor(
  requirements: SolicitationRequirementSet | null,
): OpportunityEvaluationFactor {
  const submissionRequirements =
    requirements?.requirements.filter(
      (requirement) =>
        requirement.level === "required" &&
        ["form", "submission_instruction", "pricing"].includes(requirement.type),
    ) ?? [];
  if (submissionRequirements.length === 0) {
    return {
      key: "submission-complexity",
      kind: "submission_complexity",
      status: "unknown",
      summary: "No required submission components were available to estimate submission complexity.",
      evidence: [],
    };
  }
  return {
    key: "submission-complexity",
    kind: "submission_complexity",
    status: submissionRequirements.length >= 5 ? "risk" : "pass",
    summary:
      submissionRequirements.length >= 5
        ? `The solicitation contains ${submissionRequirements.length} required submission/pricing items and may need additional preparation time.`
        : `The structured solicitation contains ${submissionRequirements.length} required submission/pricing item(s).`,
    evidence: submissionRequirements.flatMap(evidenceOf),
  };
}

function completenessFactors(requirements: SolicitationRequirementSet | null): OpportunityEvaluationFactor[] {
  if (!requirements) return [];
  const factors: OpportunityEvaluationFactor[] = [];
  if (requirements.isStale) {
    factors.push({
      key: "requirements-stale",
      kind: "qualification",
      status: "unknown",
      requirementLevel: "required",
      summary: "The latest solicitation understanding is stale and should be refreshed before a final decision.",
      evidence: [],
    });
  }
  if (requirements.completenessStatus === "partial") {
    factors.push({
      key: "requirements-partial",
      kind: "qualification",
      status: "unknown",
      requirementLevel: "required",
      summary: `Requirement coverage is partial${requirements.incompleteReasons.length ? `: ${requirements.incompleteReasons.join(", ")}` : ""}.`,
      evidence: [],
    });
  }
  return factors;
}

function assessmentFor(factors: OpportunityEvaluationFactor[]): OpportunityAssessmentState {
  if (factors.some((factor) => factor.status === "blocker")) return "no_go";

  const requiredUnknown = factors.some(
    (factor) => factor.status === "unknown" && factor.requirementLevel === "required",
  );
  if (requiredUnknown) return "conditional";

  const confirmedFit = factors.some(
    (factor) =>
      factor.status === "pass" &&
      ["scope_fit", "naics_fit", "geography"].includes(factor.kind),
  );
  return confirmedFit ? "go" : "conditional";
}

export function evaluateOpportunityInputs(
  input: OpportunityEvaluationInput,
): OpportunityEvaluationResult {
  const factors = [
    deadlineFactor(input),
    ...scopeFactors(input),
    naicsFactor(input),
    geographyFactor(input),
    ...mandatoryRequirementFactors(input),
    submissionComplexityFactor(input.requirements),
    ...completenessFactors(input.requirements),
  ];

  return {
    ruleVersion: EVALUATION_RULE_VERSION,
    inputFingerprint: fingerprint(input),
    assessment: assessmentFor(factors),
    factors,
  };
}
