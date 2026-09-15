export const SAVED_OPPORTUNITY_STATUSES = [
  "saved",
  "reviewing",
  "pursuing",
  "no_bid",
  "submitted",
  "won",
  "lost",
] as const;

export const SAVED_OPPORTUNITY_SNAPSHOT_STATUSES = [
  "not_required",
  "incomplete",
  "complete",
  "blocked",
] as const;

export type SavedOpportunityStatus = (typeof SAVED_OPPORTUNITY_STATUSES)[number];
export type SavedOpportunitySnapshotStatus =
  (typeof SAVED_OPPORTUNITY_SNAPSHOT_STATUSES)[number];

export function isSavedOpportunityStatus(value: unknown): value is SavedOpportunityStatus {
  return (
    typeof value === "string" &&
    (SAVED_OPPORTUNITY_STATUSES as readonly string[]).includes(value)
  );
}

export function isSavedOpportunitySnapshotStatus(
  value: unknown,
): value is SavedOpportunitySnapshotStatus {
  return (
    typeof value === "string" &&
    (SAVED_OPPORTUNITY_SNAPSHOT_STATUSES as readonly string[]).includes(value)
  );
}
