import type { BidWorkspaceRequirement, BidWorkspaceSection } from "./workspace";

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
) {
  const current = currentUnderstandingId
    ? requirements.filter((row) =>
        row.sourceRequirementKey?.startsWith(`${currentUnderstandingId}:`) &&
        row.evidence?.understandingId === currentUnderstandingId)
    : [];
  const activeIds = new Set(current.map((row) => row.id));
  const historical = requirements.filter((row) => !activeIds.has(row.id));
  const bySection: Record<string, BidWorkspaceRequirement[]> = Object.fromEntries(
    sections.map((section) => [section.id, []]),
  );
  const unassigned: BidWorkspaceRequirement[] = [];
  const claimed = new Set<string>();

  for (const section of sections) {
    const keys = new Set(
      Array.isArray(section.requirementLinks.sourceRequirementKeys)
        ? section.requirementLinks.sourceRequirementKeys.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    for (const row of current) {
      if (!row.sourceRequirementKey || nonWritingTypes.has(row.requirementType) ||
          claimed.has(row.id) || !keys.has(row.sourceRequirementKey)) continue;
      bySection[section.id]!.push(row);
      claimed.add(row.id);
    }
  }
  for (const row of current) {
    if (!claimed.has(row.id)) unassigned.push(row);
  }
  return { current, historical, bySection, unassigned };
}

export type BidBuilderGroups = ReturnType<typeof groupBidBuilderRequirements>;
