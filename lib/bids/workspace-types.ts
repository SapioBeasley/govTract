export const BID_WORKSPACE_STATUSES = [
  "draft",
  "in_progress",
  "ready_for_review",
  "complete",
] as const;

export const BID_WORKSPACE_REVIEW_STATES = [
  "not_started",
  "in_review",
  "needs_changes",
  "approved",
] as const;

export type BidWorkspaceStatus = (typeof BID_WORKSPACE_STATUSES)[number];
export type BidWorkspaceReviewState = (typeof BID_WORKSPACE_REVIEW_STATES)[number];

export function isBidWorkspaceStatus(value: unknown): value is BidWorkspaceStatus {
  return typeof value === "string" && BID_WORKSPACE_STATUSES.includes(value as BidWorkspaceStatus);
}

export function isBidWorkspaceReviewState(value: unknown): value is BidWorkspaceReviewState {
  return (
    typeof value === "string" &&
    BID_WORKSPACE_REVIEW_STATES.includes(value as BidWorkspaceReviewState)
  );
}
