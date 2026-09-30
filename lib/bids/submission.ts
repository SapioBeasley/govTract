import type { BidWorkspaceStatus } from "./workspace-types";

export type BidSubmissionRecord = {
  id: string;
  bidWorkspaceId: string;
  reviewFingerprint: string;
  submittedAt: Date;
  confirmationNumber: string | null;
  receiptUrl: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function currentSubmissionForPackage(
  submissions: BidSubmissionRecord[],
  reviewFingerprint: string,
  approvalCurrent: boolean,
): BidSubmissionRecord | null {
  if (!approvalCurrent) return null;
  return submissions.find((submission) => submission.reviewFingerprint === reviewFingerprint) ?? null;
}

export function effectiveBidStatus(
  storedStatus: BidWorkspaceStatus,
  currentSubmission: BidSubmissionRecord | null,
): BidWorkspaceStatus {
  if (currentSubmission) return "submitted";
  return storedStatus === "submitted" ? "complete" : storedStatus;
}
