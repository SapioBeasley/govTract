import type { BidWorkspaceRequirement, BidWorkspaceSection } from "./workspace";
import { isAgencyBaselineRequirement } from "@/lib/procurement/documents/roles";

/** These buyer checks must not be silently converted into prose coverage by a fallback heading. */
const nonWritingTypes = new Set([
  "submission_instruction", "deadline", "disqualifier", "mandatory_event",
  "schedule", "evaluation", "location",
]);

/**
 * A read-only projection. Never rebind old responses to a new understanding by
 * matching text or type, and never duplicate completion controls across headings.
 */
export function groupBidBuilderRequirements(
  requirements: BidWorkspaceRequirement[],
  sections: BidWorkspaceSection[],
  currentUnderstandingId: string | null,
  sourceRequirements: Array<{ id: string; requirementKey: string; details?: Record<string, unknown> }> = [],
) {
  const current = currentUnderstandingId
    ? requirements.filter((row) =>
        row.sourceRequirementKey?.startsWith(`${currentUnderstandingId}:`) &&
        row.evidence?.understandingId === currentUnderstandingId)
    : [];
  const activeIds = new Set(current.map((row) => row.id));
  const historical = requirements.filter((row) => !activeIds.has(row.id));
  // Outline links store the source requirementKey while compliance rows store
  // understandingId:source UUID. Join through the actual persisted source ID.
  const sourceByComplianceKey = new Map(sourceRequirements.map((source) => [
    `${currentUnderstandingId}:${source.id}`, source,
  ]));
  const outlineKeyByComplianceKey = new Map([...sourceByComplianceKey].map(([key, source]) => [
    key, source.requirementKey,
  ]));
  const baselineComplianceKeys = new Set([...sourceByComplianceKey]
    .filter(([, source]) => isAgencyBaselineRequirement(source))
    .map(([key]) => key));
  const baselineOutlineKeys = new Set(sourceRequirements
    .filter(isAgencyBaselineRequirement)
    .map((source) => source.requirementKey));
  const baselineOnlySectionIds: string[] = [];
  const bySection: Record<string, BidWorkspaceRequirement[]> = Object.fromEntries(
    sections.map((section) => [section.id, []]),
  );
  const unassigned: BidWorkspaceRequirement[] = [];
  const baseline: BidWorkspaceRequirement[] = [];
  const claimed = new Set<string>();

  for (const section of sections) {
    const keys = new Set(
      Array.isArray(section.requirementLinks.sourceRequirementKeys)
        ? section.requirementLinks.sourceRequirementKeys.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    if (keys.size > 0 && [...keys].every((key) =>
      baselineOutlineKeys.has(key) || baselineComplianceKeys.has(key))) {
      baselineOnlySectionIds.push(section.id);
    }
    for (const row of current) {
      const prescribedResponse = row.requirementType === "submission_instruction" &&
        section.metadata.source === "solicitation_heading";
      if (!row.sourceRequirementKey || baselineComplianceKeys.has(row.sourceRequirementKey) ||
          (nonWritingTypes.has(row.requirementType) && !prescribedResponse) ||
          claimed.has(row.id) || (!keys.has(row.sourceRequirementKey) &&
            !keys.has(outlineKeyByComplianceKey.get(row.sourceRequirementKey) ?? ""))) continue;
      bySection[section.id]!.push(row);
      claimed.add(row.id);
    }
  }
  for (const row of current) {
    if (claimed.has(row.id)) continue;
    if (row.sourceRequirementKey && baselineComplianceKeys.has(row.sourceRequirementKey)) baseline.push(row);
    else unassigned.push(row);
  }
  return { current, historical, bySection, unassigned, baseline, baselineOnlySectionIds };
}

export type BidBuilderGroups = ReturnType<typeof groupBidBuilderRequirements>;
