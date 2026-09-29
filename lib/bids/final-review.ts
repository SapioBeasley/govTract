import { createHash } from "node:crypto";

import { deriveSupportingDocumentItems, findFullBidSection, hasNeedsInput } from "@/lib/bids/full-bid";

import type { BidWorkspaceRecord } from "@/lib/bids/workspace";
import type { ListingEvidence } from "@/lib/procurement/requirements/listing-evidence";

export type FinalReviewIssue = {
  code: string;
  message: string;
  requirementId?: string;
  sectionId?: string;
  documentId?: string;
};

export type FinalReviewSourceReference = {
  snapshotDocumentId: string | null;
  opportunityDocumentVersionId: string;
  filename: string | null;
  checksumSha256: string | null;
  locator: Record<string, unknown>;
  excerpt: string | null;
};

export type FinalReviewSourceCheck = {
  requirementId: string;
  text: string;
  kind: string;
  mandatory: boolean;
  responseStatus: string;
  originalRequired: boolean;
  originalConfirmed: boolean;
  originalDocuments: Array<{
    id: string;
    filename: string;
    opportunityDocumentVersionId: string;
    checksumSha256: string | null;
    status: string;
  }>;
  references: FinalReviewSourceReference[];
  listingEvidence?: ListingEvidence | null;
};

type ReviewWorkspace = Pick<
  BidWorkspaceRecord,
  "sourceSnapshot" | "sourceRequirements" | "sections" | "dueAt"
>;

export type FinalReviewInput = {
  workspace: ReviewWorkspace;
  portalUrl: string | null;
  confirmedOriginalForms?: string[];
  now?: Date;
};

/**
 * Read-only final package evaluation for the simplified bid flow.
 * The retained metadata key confirmedOriginalForms is intentionally reused as the
 * compatibility store for bidder-side supporting-item confirmations until a later
 * additive migration can rename it without discarding saved user state.
 */
export function evaluateBidFinalReview(input: FinalReviewInput) {
  const { workspace, portalUrl } = input;
  const snapshot = workspace.sourceSnapshot;
  const source = workspace.sourceRequirements;
  const confirmed = new Set(input.confirmedOriginalForms ?? []);
  const issues: FinalReviewIssue[] = [];
  const issue = (code: string, message: string, extra: Omit<FinalReviewIssue, "code" | "message"> = {}) => {
    issues.push({ code, message, ...extra });
  };

  if (!snapshot.pursuitSnapshotId || snapshot.snapshotStatus !== "complete" ||
      snapshot.storedDocumentCount !== snapshot.totalDocumentCount ||
      snapshot.documents.some((document) => document.status !== "stored" || !document.checksumSha256)) {
    issue("source_snapshot_incomplete", "The complete authoritative solicitation package is not readable.");
  }
  if (snapshot.stale || !snapshot.documentSetFingerprint ||
      snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint) {
    issue("source_snapshot_stale", "An authoritative solicitation document or amendment changed after this bid snapshot.");
  }
  if (!source || source.isStale || source.completenessStatus !== "complete" || !source.requirements.length) {
    issue("source_requirements_unavailable", "The current solicitation requirements are not ready for bid packaging.");
  }
  if (!portalUrl || !/^https:\/\/[^\s/]+(?:\/|$)/i.test(portalUrl)) {
    issue("submission_portal_unverified", "Confirm the authoritative external solicitation and submission channel.");
  }
  if (!workspace.dueAt) {
    issue("submission_deadline_unverified", "Confirm the authoritative submission due date and time.");
  } else if (workspace.dueAt.getTime() <= (input.now ?? new Date()).getTime()) {
    issue("submission_deadline_elapsed", "The recorded submission deadline has passed; verify any extension at the source.");
  }

  const fullBid = findFullBidSection(workspace.sections);
  if (!fullBid?.content?.trim()) {
    issue("full_bid_missing", "Generate and save the full bid draft before packaging.");
  } else {
    if (hasNeedsInput(fullBid.content)) {
      issue("section_placeholder", "The full bid still contains one or more Needs your input placeholders.", { sectionId: fullBid.id });
    }
    if (fullBid.metadata.snapshotStale === true ||
        fullBid.metadata.understandingStale === true ||
        fullBid.metadata.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
        fullBid.metadata.documentSetFingerprint !== snapshot.documentSetFingerprint ||
        (source && fullBid.metadata.understandingId !== source.understandingId)) {
      issue("section_source_stale", "The saved full bid was prepared against an older solicitation version.", { sectionId: fullBid.id });
    }
  }

  const byVersion = new Map(snapshot.documents.map((document) => [
    document.opportunityDocumentVersionId,
    document,
  ]));
  const sourceChecks: FinalReviewSourceCheck[] = [];
  const supporting = deriveSupportingDocumentItems(source?.requirements ?? []);
  for (const item of supporting) {
    const requirement = source?.requirements.find((row) => row.id === item.requirementId);
    const references = (requirement?.evidence ?? []).map((evidence) => {
      const document = byVersion.get(evidence.opportunityDocumentVersionId);
      return {
        snapshotDocumentId: document?.id ?? null,
        opportunityDocumentVersionId: evidence.opportunityDocumentVersionId,
        filename: document?.filename ?? null,
        checksumSha256: document?.checksumSha256 ?? null,
        locator: evidence.locator,
        excerpt: evidence.excerpt,
      };
    });
    const current = confirmed.has(item.requirementId);
    if (item.mandatory && !current) {
      issue("supporting_item_unconfirmed",
        `Required supporting item has not been marked ready/included: ${item.text}`,
        { requirementId: item.requirementId });
    }
    if (item.mandatory && !references.length && !requirement?.listingEvidence) {
      issue("source_evidence_unverified",
        `Source provenance is unavailable for required supporting item: ${item.text}`,
        { requirementId: item.requirementId });
    }
    sourceChecks.push({
      requirementId: item.requirementId,
      text: item.text,
      kind: item.kind,
      mandatory: item.mandatory,
      responseStatus: current ? "included_or_ready" : item.mandatory ? "missing" : "conditional",
      // Kept for compatibility with existing workspace metadata and API payload shape.
      originalRequired: true,
      originalConfirmed: current,
      originalDocuments: item.sourceVersionIds.flatMap((versionId) => {
        const document = byVersion.get(versionId);
        return document ? [{
          id: document.id,
          filename: document.filename,
          opportunityDocumentVersionId: document.opportunityDocumentVersionId,
          checksumSha256: document.checksumSha256,
          status: document.status,
        }] : [];
      }),
      references,
      listingEvidence: requirement?.listingEvidence ?? null,
    });
  }

  const submissionInstructions = source?.requirements
    .filter((requirement) => requirement.type === "submission_instruction")
    .map((requirement) => requirement.text) ?? [];

  const reviewFingerprint = createHash("sha256").update(JSON.stringify({
    snapshotId: snapshot.pursuitSnapshotId,
    sourceFingerprint: snapshot.documentSetFingerprint,
    currentSourceFingerprint: snapshot.currentDocumentSetFingerprint,
    understandingId: source?.understandingId ?? null,
    fullBid: fullBid ? [fullBid.id, fullBid.content, fullBid.metadata] : null,
    confirmedSupportingItems: [...confirmed].sort(),
    portalUrl,
    dueAt: workspace.dueAt?.toISOString() ?? null,
  })).digest("hex");

  return {
    blockingIssues: issues,
    readyForHumanReview: issues.length === 0,
    readyForExternalSubmission: false,
    reviewFingerprint,
    sourceChecks,
    submission: {
      portalUrl,
      dueAt: workspace.dueAt,
      method: submissionInstructions.length
        ? "Follow the authoritative source instructions"
        : "Verify the authoritative submission instructions",
      instructions: submissionInstructions,
    },
  };
}
