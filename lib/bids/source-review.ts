import type { ComplianceEvidence } from "./compliance";

export type SourceReviewRecord = {
  understandingId: string;
  sourceRequirementId: string;
  snapshotId: string;
  sourceFingerprint: string;
  level: "required" | "optional";
  documentVersionId: string;
  documentChecksum: string;
  snapshotDocumentId: string;
  segmentId: string;
  locator: Record<string, unknown>;
  excerpt: string;
};

type SourceReviewContext = {
  understandingId: string | null;
  snapshotId: string | null;
  fingerprint: string | null;
  documents: Array<{ id: string; opportunityDocumentVersionId: string;
    status: string; checksumSha256: string | null }>;
};

/** The original AI finding and pinned compliance evidence are immutable. A separately
 * audited human decision is applicable only to the identical retained originals. */
export function applySourceReview(
  original: ComplianceEvidence,
  review: SourceReviewRecord | null | undefined,
  context: SourceReviewContext,
): ComplianceEvidence {
  if (!review || review.understandingId !== original.understandingId ||
      review.sourceRequirementId !== original.sourceRequirementId ||
      review.understandingId !== context.understandingId ||
      review.snapshotId !== original.pursuitSnapshotId ||
      review.snapshotId !== context.snapshotId ||
      review.sourceFingerprint !== context.fingerprint ||
      !review.excerpt.trim() ||
      !context.documents.some((document) => document.id === review.snapshotDocumentId &&
        document.opportunityDocumentVersionId === review.documentVersionId &&
        document.status === "stored" && document.checksumSha256 === review.documentChecksum)) {
    return original;
  }
  const reference = {
    snapshotDocumentId: review.snapshotDocumentId,
    opportunityDocumentVersionId: review.documentVersionId,
    filename: null,
    checksumSha256: review.documentChecksum,
    documentExtractionSegmentId: review.segmentId,
    locator: review.locator,
    excerpt: review.excerpt,
  };
  const verifiedReferences = original.references.filter((item) => item.excerpt?.trim() &&
    context.documents.some((document) => document.id === item.snapshotDocumentId &&
      document.opportunityDocumentVersionId === item.opportunityDocumentVersionId &&
      document.checksumSha256 === item.checksumSha256 && document.status === "stored"));
  return {
    ...original,
    requirementLevel: review.level,
    references: verifiedReferences.some((item) =>
      item.snapshotDocumentId === review.snapshotDocumentId &&
      item.documentExtractionSegmentId === review.segmentId && item.excerpt?.trim())
      ? verifiedReferences : [...verifiedReferences, reference],
    issues: original.issues.filter((issue) => ![
      "requirement_requiredness_unknown", "requirement_evidence_missing",
      "requirement_set_incomplete",
    ].includes(issue)),
  };
}
