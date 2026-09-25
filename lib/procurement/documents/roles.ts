import { createHash } from "node:crypto";

export const AGENCY_BASELINE_MIN_OPPORTUNITIES = 3;
export type SourceDocumentRole = "opportunity_specific" | "agency_baseline";

export function classifyRepeatedDocumentRole(input: {
  sourceDocumentKey: string | null | undefined;
  checksumSha256: string | null | undefined;
  distinctOpportunityCount: number;
}): SourceDocumentRole {
  if (!input.sourceDocumentKey?.trim() || !/^[0-9a-f]{64}$/i.test(input.checksumSha256 ?? "")) {
    return "opportunity_specific";
  }
  return input.distinctOpportunityCount >= AGENCY_BASELINE_MIN_OPPORTUNITIES
    ? "agency_baseline"
    : "opportunity_specific";
}

export function isAgencyBaselineRequirement(
  requirement: { details?: Record<string, unknown> | null },
): boolean {
  return requirement.details?.sourceDocumentRole === "agency_baseline";
}

export function agencyBaselineReviewFingerprint(
  requirements: Array<{
    id: string;
    requirementKey: string;
    type: string;
    level: string;
    text: string;
    evidence: Array<{ opportunityDocumentVersionId: string }>;
    details?: Record<string, unknown> | null;
  }>,
  sourceFingerprint: string | null,
): string | null {
  if (!sourceFingerprint) return null;
  const baseline = requirements
    .filter(isAgencyBaselineRequirement)
    .map((requirement) => [
      requirement.id,
      requirement.requirementKey,
      requirement.type,
      requirement.level,
      requirement.text,
      [...new Set(requirement.evidence.map((evidence) => evidence.opportunityDocumentVersionId))].sort(),
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!baseline.length) return null;
  return createHash("sha256")
    .update(JSON.stringify({ sourceFingerprint, baseline }))
    .digest("hex");
}
