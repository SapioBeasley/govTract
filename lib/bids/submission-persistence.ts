import { desc, eq } from "drizzle-orm";

import { bidSubmissions, bidWorkspaces } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";
import type { BidSubmissionRecord } from "@/lib/bids/submission";
import { getBidWorkspace } from "@/lib/bids/workspace";

export type RecordExternalSubmissionInput = {
  submittedAt: string | Date;
  confirmationNumber?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
};

function optionalText(value: string | null | undefined, max: number, label: string) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${label} is too long`);
  return trimmed;
}

function parseSubmittedAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Submission date/time is invalid");
  return date;
}

function validateReceiptUrl(value: string | null) {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Receipt link must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("Receipt link must use HTTPS");
  return url.toString();
}

export async function listBidSubmissions(workspaceId: string): Promise<BidSubmissionRecord[]> {
  const db = getDb();
  return db
    .select()
    .from(bidSubmissions)
    .where(eq(bidSubmissions.bidWorkspaceId, workspaceId))
    .orderBy(desc(bidSubmissions.submittedAt), desc(bidSubmissions.createdAt));
}

export async function recordExternalSubmission(
  workspaceId: string,
  input: RecordExternalSubmissionInput,
): Promise<BidSubmissionRecord> {
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  if (!workspace.finalReviewApprovalCurrent || !workspace.finalReview.readyForHumanReview) {
    throw new Error("Approve the exact current package before confirming external submission");
  }

  const submittedAt = parseSubmittedAt(input.submittedAt);
  const confirmationNumber = optionalText(input.confirmationNumber, 500, "Confirmation/reference number");
  const receiptUrl = validateReceiptUrl(optionalText(input.receiptUrl, 2_000, "Receipt link"));
  const notes = optionalText(input.notes, 10_000, "Submission notes");
  const reviewFingerprint = workspace.finalReview.reviewFingerprint;
  const db = getDb();

  await db
    .insert(bidSubmissions)
    .values({
      bidWorkspaceId: workspaceId,
      reviewFingerprint,
      submittedAt,
      confirmationNumber,
      receiptUrl,
      notes,
    })
    .onConflictDoUpdate({
      target: [bidSubmissions.bidWorkspaceId, bidSubmissions.reviewFingerprint],
      set: {
        submittedAt,
        confirmationNumber,
        receiptUrl,
        notes,
        updatedAt: new Date(),
      },
    });

  await db
    .update(bidWorkspaces)
    .set({ status: "submitted", updatedAt: new Date() })
    .where(eq(bidWorkspaces.id, workspaceId));

  const [record] = await db
    .select()
    .from(bidSubmissions)
    .where(eq(bidSubmissions.bidWorkspaceId, workspaceId))
    .orderBy(desc(bidSubmissions.updatedAt))
    .limit(1);

  if (!record || record.reviewFingerprint !== reviewFingerprint) {
    throw new Error("External submission confirmation could not be persisted");
  }
  return record;
}
