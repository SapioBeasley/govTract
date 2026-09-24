import { and, eq, inArray, sql } from "drizzle-orm";

import { getBidWorkspace } from "./workspace";
import { isComplianceEvidence } from "./compliance";
import { bidRequirementSourceReviews } from "@/lib/db/source-review-schema";
import { getDb } from "@/lib/db/client";
import { documentExtractions, documentExtractionSegments,
  opportunityDocumentVersionExtractions } from "@/lib/db/document-extractions-schema";

/** Explicit single-user review: a source quote must be found verbatim in an
 * extraction attached to the exact retained original version and checksum. */
export async function reviewBidRequirementSource(
  workspaceId: string,
  requirementId: string,
  input: {
    level: "required" | "optional";
    documentVersionId: string;
    excerpt: string;
    reviewerNote: string;
    confirmed: true;
  },
) {
  if (!["required", "optional"].includes(input.level) || input.confirmed !== true ||
      typeof input.excerpt !== "string" || input.excerpt.trim().length < 20 ||
      input.excerpt.length > 480 || typeof input.reviewerNote !== "string" ||
      input.reviewerNote.trim().length < 10 || input.reviewerNote.length > 2000) {
    throw new Error("Choose required or optional, paste a 20–480 character verbatim excerpt, explain your decision, and confirm you reviewed the original.");
  }
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  const requirement = workspace.requirements.find((row) => row.id === requirementId);
  const source = workspace.sourceRequirements;
  const snapshot = workspace.sourceSnapshot;
  if (!requirement || !isComplianceEvidence(requirement.originalEvidence ?? requirement.evidence) ||
      !source || source.isStale || !snapshot.pursuitSnapshotId || !snapshot.documentSetFingerprint ||
      snapshot.snapshotStatus !== "complete" || snapshot.stale ||
      snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint ||
      snapshot.storedDocumentCount !== snapshot.totalDocumentCount ||
      snapshot.documents.some((document) => document.status !== "stored" || !document.checksumSha256)) {
    throw new Error("The current complete retained source package and requirement must be available before source review.");
  }
  const original = (requirement.originalEvidence ?? requirement.evidence);
  if (!isComplianceEvidence(original) ||
      original.understandingId !== source.understandingId ||
      original.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
      requirement.sourceRequirementKey !== `${source.understandingId}:${original.sourceRequirementId}` ||
      !source.requirements.some((row) => row.id === original.sourceRequirementId)) {
    throw new Error("Historical requirements cannot be rebound to a newer source package.");
  }
  const document = snapshot.documents.find((item) =>
    item.opportunityDocumentVersionId === input.documentVersionId &&
    item.status === "stored" && item.checksumSha256);
  if (!document) throw new Error("Select a retained original document in the current immutable bid snapshot.");
  const db = getDb();
  const excerpt = input.excerpt.trim();
  const [segment] = await db.select({
    id: documentExtractionSegments.id,
    locator: documentExtractionSegments.locator,
  }).from(documentExtractionSegments)
    .innerJoin(documentExtractions,
      eq(documentExtractionSegments.documentExtractionId, documentExtractions.id))
    .innerJoin(opportunityDocumentVersionExtractions,
      eq(opportunityDocumentVersionExtractions.documentExtractionId, documentExtractions.id))
    .where(and(
      eq(opportunityDocumentVersionExtractions.opportunityDocumentVersionId, document.opportunityDocumentVersionId),
      eq(documentExtractions.checksumSha256, document.checksumSha256!),
      inArray(documentExtractions.status, ["extracted", "truncated"]),
      sql`position(${excerpt} in ${documentExtractionSegments.content}) > 0`,
    )).limit(1);
  if (!segment) {
    throw new Error("That passage was not found verbatim in the checksum-matched extraction of the chosen original. Retrieve/re-extract the source or choose an exact passage. This review cannot override missing source evidence.");
  }
  await db.insert(bidRequirementSourceReviews).values({
    bidWorkspaceId: workspaceId, bidRequirementId: requirementId,
    understandingId: source.understandingId,
    sourceRequirementId: original.sourceRequirementId,
    snapshotId: snapshot.pursuitSnapshotId,
    sourceFingerprint: snapshot.documentSetFingerprint,
    level: input.level,
    documentVersionId: document.opportunityDocumentVersionId,
    documentChecksum: document.checksumSha256!,
    snapshotDocumentId: document.id, segmentId: segment.id,
    locator: segment.locator, excerpt, reviewerNote: input.reviewerNote.trim(),
  }).onConflictDoNothing();
  return getBidWorkspace(workspaceId);
}
