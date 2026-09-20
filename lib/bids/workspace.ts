import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { isComplianceEvidence, resolveComplianceStatus, type ComplianceStatus } from "@/lib/bids/compliance";
import { evaluateBidFinalReview } from "@/lib/bids/final-review";

import {
  bidRequirements,
  bidSections,
  bidWorkspaces,
} from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";
import { pursuitDocumentSnapshots } from "@/lib/db/pursuit-snapshots-schema";
import { opportunities } from "@/lib/db/schema";
import { updateSavedOpportunity } from "@/lib/opportunities/saved";
import {
  ensurePursuitSnapshotPrepared,
  getCurrentOpportunityDocumentSetFingerprint,
  getPursuitSnapshot,
} from "@/lib/procurement/pursuits/snapshot";
import { loadLatestSolicitationRequirements } from "@/lib/procurement/requirements/persistence";

import {
  BID_WORKSPACE_REVIEW_STATES,
  BID_WORKSPACE_STATUSES,
  isBidWorkspaceReviewState,
  isBidWorkspaceStatus,
  type BidWorkspaceReviewState,
  type BidWorkspaceStatus,
} from "@/lib/bids/workspace-types";

export {
  BID_WORKSPACE_REVIEW_STATES,
  BID_WORKSPACE_STATUSES,
  isBidWorkspaceReviewState,
  isBidWorkspaceStatus,
};
export type { BidWorkspaceReviewState, BidWorkspaceStatus };

export type BidWorkspaceSourceSnapshot = {
  pursuitSnapshotId: string | null;
  documentSetFingerprint: string | null;
  currentDocumentSetFingerprint: string | null;
  snapshotStatus: "incomplete" | "complete" | "blocked" | "unknown";
  stale: boolean;
  staleReason: string | null;
  supersedesSnapshotId: string | null;
  totalDocumentCount: number;
  storedDocumentCount: number;
  blockedDocumentCount: number;
  failedDocumentCount: number;
  documents: Array<{
    id: string;
    opportunityDocumentVersionId: string;
    filename: string;
    status: string;
    failureCode: string | null;
    checksumSha256: string | null;
  }>;
};

export type BidWorkspaceRequirement = {
  id: string;
  sourceRequirementKey: string | null;
  requirementType: string;
  text: string;
  isRequired: boolean;
  status: string;
  effectiveStatus: ComplianceStatus;
  canMarkComplete: boolean;
  evidence: Record<string, unknown>;
  responseNotes: string | null;
  sortOrder: number;
};

export type BidWorkspaceSection = {
  id: string;
  title: string;
  instructions: string | null;
  content: string | null;
  status: string;
  requirementLinks: Record<string, unknown>;
  sortOrder: number;
  wordCount: number;
  metadata: Record<string, unknown>;
};

export type BidWorkspaceRecord = {
  id: string;
  opportunityId: string;
  title: string;
  opportunityTitle: string;
  agencyName: string | null;
  dueAt: Date | null;
  submissionUrl: string | null;
  status: BidWorkspaceStatus;
  reviewState: BidWorkspaceReviewState;
  notes: string | null;
  confirmedOriginalForms: string[];
  finalReview: ReturnType<typeof evaluateBidFinalReview>;
  finalReviewApprovalCurrent: boolean;
  sourceSnapshot: BidWorkspaceSourceSnapshot;
  sourceRequirements: Awaited<ReturnType<typeof loadLatestSolicitationRequirements>>;
  requirements: BidWorkspaceRequirement[];
  sections: BidWorkspaceSection[];
  createdAt: Date;
  updatedAt: Date;
};

export type BidWorkspaceSummary = {
  id: string;
  opportunityId: string;
  title: string;
  opportunityTitle: string;
  agencyName: string | null;
  dueAt: Date | null;
  status: BidWorkspaceStatus;
  reviewState: BidWorkspaceReviewState;
  notes: string | null;
  snapshotStatus: BidWorkspaceSourceSnapshot["snapshotStatus"];
  snapshotStale: boolean;
  updatedAt: Date;
};

export type UpdateBidWorkspaceInput = {
  status?: BidWorkspaceStatus;
  reviewState?: BidWorkspaceReviewState;
  notes?: string | null;
  confirmedOriginalForms?: string[];
  humanReviewConfirmed?: boolean;
};

function metadataState(metadata: Record<string, unknown>) {
  const reviewState = isBidWorkspaceReviewState(metadata.reviewState)
    ? metadata.reviewState
    : "not_started";
  const notes = typeof metadata.notes === "string" && metadata.notes.trim()
    ? metadata.notes
    : null;
  return { reviewState, notes };
}

function snapshotJson(sourceSnapshot: Record<string, unknown>) {
  return {
    pursuitSnapshotId:
      typeof sourceSnapshot.pursuitSnapshotId === "string"
        ? sourceSnapshot.pursuitSnapshotId
        : null,
    documentSetFingerprint:
      typeof sourceSnapshot.documentSetFingerprint === "string"
        ? sourceSnapshot.documentSetFingerprint
        : null,
    snapshotStatus:
      sourceSnapshot.snapshotStatus === "complete" ||
      sourceSnapshot.snapshotStatus === "blocked" ||
      sourceSnapshot.snapshotStatus === "incomplete"
        ? sourceSnapshot.snapshotStatus
        : "unknown",
    stale: sourceSnapshot.stale === true,
    staleReason:
      typeof sourceSnapshot.staleReason === "string"
        ? sourceSnapshot.staleReason
        : null,
  } as const;
}

async function loadSourceSnapshot(
  opportunityId: string,
  sourceSnapshot: Record<string, unknown>,
): Promise<BidWorkspaceSourceSnapshot> {
  const stored = snapshotJson(sourceSnapshot);
  const currentDocumentSetFingerprint =
    await getCurrentOpportunityDocumentSetFingerprint(opportunityId);
  const fingerprintChanged =
    Boolean(stored.documentSetFingerprint) &&
    stored.documentSetFingerprint !== currentDocumentSetFingerprint;
  const stale = stored.stale || fingerprintChanged;
  const staleReason = stale
    ? stored.staleReason ?? "authoritative_document_set_changed"
    : null;
  const snapshot = stored.pursuitSnapshotId
    ? await getPursuitSnapshot(stored.pursuitSnapshotId)
    : null;

  return {
    pursuitSnapshotId: stored.pursuitSnapshotId,
    documentSetFingerprint: stored.documentSetFingerprint,
    currentDocumentSetFingerprint,
    snapshotStatus:
      snapshot?.status === "complete" ||
      snapshot?.status === "blocked" ||
      snapshot?.status === "incomplete"
        ? snapshot.status
        : stored.snapshotStatus,
    stale,
    staleReason,
    supersedesSnapshotId: snapshot?.supersedesSnapshotId ?? null,
    totalDocumentCount: snapshot?.totalDocumentCount ?? 0,
    storedDocumentCount: snapshot?.storedDocumentCount ?? 0,
    blockedDocumentCount: snapshot?.blockedDocumentCount ?? 0,
    failedDocumentCount: snapshot?.failedDocumentCount ?? 0,
    documents:
      snapshot?.documents.map((document) => ({
        id: document.id,
        opportunityDocumentVersionId: document.opportunityDocumentVersionId,
        filename: document.filename,
        status: document.status,
        failureCode: document.failureCode,
        checksumSha256: document.checksumSha256,
      })) ?? [],
  };
}

async function selectWorkspace(workspaceId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: bidWorkspaces.id,
      opportunityId: bidWorkspaces.opportunityId,
      title: bidWorkspaces.title,
      opportunityTitle: opportunities.title,
      agencyName: opportunities.agencyName,
      dueAt: opportunities.dueAt,
      submissionUrl: opportunities.canonicalUrl,
      status: bidWorkspaces.status,
      sourceSnapshot: bidWorkspaces.sourceSnapshot,
      metadata: bidWorkspaces.metadata,
      createdAt: bidWorkspaces.createdAt,
      updatedAt: bidWorkspaces.updatedAt,
    })
    .from(bidWorkspaces)
    .innerJoin(opportunities, eq(opportunities.id, bidWorkspaces.opportunityId))
    .where(eq(bidWorkspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function getBidWorkspace(workspaceId: string): Promise<BidWorkspaceRecord | null> {
  const row = await selectWorkspace(workspaceId);
  if (!row) return null;
  if (!isBidWorkspaceStatus(row.status)) {
    throw new Error("Stored bid workspace status is invalid");
  }

  const db = getDb();
  const [requirements, sections, sourceRequirements, sourceSnapshot] = await Promise.all([
    db
      .select({
        id: bidRequirements.id,
        sourceRequirementKey: bidRequirements.sourceRequirementKey,
        requirementType: bidRequirements.requirementType,
        text: bidRequirements.text,
        isRequired: bidRequirements.isRequired,
        status: bidRequirements.status,
        evidence: bidRequirements.evidence,
        responseNotes: bidRequirements.responseNotes,
        sortOrder: bidRequirements.sortOrder,
      })
      .from(bidRequirements)
      .where(eq(bidRequirements.bidWorkspaceId, workspaceId))
      .orderBy(asc(bidRequirements.sortOrder), asc(bidRequirements.id)),
    db
      .select({
        id: bidSections.id,
        title: bidSections.title,
        instructions: bidSections.instructions,
        content: bidSections.content,
        status: bidSections.status,
        requirementLinks: bidSections.requirementLinks,
        sortOrder: bidSections.sortOrder,
        wordCount: bidSections.wordCount,
        metadata: bidSections.metadata,
      })
      .from(bidSections)
      .where(eq(bidSections.bidWorkspaceId, workspaceId))
      .orderBy(asc(bidSections.sortOrder), asc(bidSections.id)),
    loadLatestSolicitationRequirements(row.opportunityId),
    loadSourceSnapshot(row.opportunityId, row.sourceSnapshot ?? {}),
  ]);

  const state = metadataState(row.metadata ?? {});
  const confirmedOriginalForms =
    row.metadata?.originalFormsFingerprint === sourceSnapshot.documentSetFingerprint &&
    !sourceSnapshot.stale &&
    Array.isArray(row.metadata?.confirmedOriginalForms)
      ? row.metadata.confirmedOriginalForms.filter((id): id is string => typeof id === "string")
      : [];
  const workspace = {
    ...row,
    status: row.status,
    reviewState: state.reviewState,
    notes: state.notes,
    sourceSnapshot,
    sourceRequirements,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      effectiveStatus: sourceRequirements?.completenessStatus === "complete" && !sourceRequirements.isStale && isComplianceEvidence(requirement.evidence)
        ? resolveComplianceStatus(
            requirement.status,
            requirement.evidence,
            sourceSnapshot,
            sourceRequirements.understandingId,
          )
        : "needs_review" as const,
      canMarkComplete: sourceRequirements?.completenessStatus === "complete" && !sourceRequirements.isStale && isComplianceEvidence(requirement.evidence)
        ? resolveComplianceStatus("complete", requirement.evidence, sourceSnapshot, sourceRequirements.understandingId) === "complete"
        : false,
    })),
    sections,
  };
  const finalReview = evaluateBidFinalReview({
    workspace,
    portalUrl: row.submissionUrl,
    confirmedOriginalForms,
  });
  const finalReviewApprovalCurrent = state.reviewState === "approved" &&
    row.metadata?.finalReviewApprovalFingerprint === finalReview.reviewFingerprint &&
    finalReview.readyForHumanReview;
  return {
    ...workspace,
    confirmedOriginalForms,
    finalReview: {
      ...finalReview,
      readyForExternalSubmission: finalReviewApprovalCurrent,
    },
    finalReviewApprovalCurrent,
  };
}

export async function getBidWorkspaceForOpportunity(opportunityId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: bidWorkspaces.id })
    .from(bidWorkspaces)
    .where(
      and(
        eq(bidWorkspaces.opportunityId, opportunityId),
        isNull(bidWorkspaces.companyProfileId),
      ),
    )
    .orderBy(desc(bidWorkspaces.createdAt))
    .limit(1);
  return row ? getBidWorkspace(row.id) : null;
}

export async function listBidWorkspaces(): Promise<BidWorkspaceSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: bidWorkspaces.id,
      opportunityId: bidWorkspaces.opportunityId,
      title: bidWorkspaces.title,
      opportunityTitle: opportunities.title,
      agencyName: opportunities.agencyName,
      dueAt: opportunities.dueAt,
      status: bidWorkspaces.status,
      sourceSnapshot: bidWorkspaces.sourceSnapshot,
      metadata: bidWorkspaces.metadata,
      updatedAt: bidWorkspaces.updatedAt,
    })
    .from(bidWorkspaces)
    .innerJoin(opportunities, eq(opportunities.id, bidWorkspaces.opportunityId))
    .where(isNull(bidWorkspaces.companyProfileId))
    .orderBy(desc(bidWorkspaces.updatedAt));

  return Promise.all(
    rows.map(async (row) => {
      if (!isBidWorkspaceStatus(row.status)) {
        throw new Error("Stored bid workspace status is invalid");
      }
      const state = metadataState(row.metadata ?? {});
      const snapshot = await loadSourceSnapshot(
        row.opportunityId,
        row.sourceSnapshot ?? {},
      );
      return {
        ...row,
        status: row.status,
        reviewState: state.reviewState,
        notes: state.notes,
        snapshotStatus: snapshot.snapshotStatus,
        snapshotStale: snapshot.stale,
      };
    }),
  );
}

export async function ensureBidWorkspaceForOpportunity(
  opportunityId: string,
): Promise<BidWorkspaceRecord> {
  const db = getDb();
  const [opportunity] = await db
    .select({ id: opportunities.id, title: opportunities.title })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  if (!opportunity) throw new Error("Opportunity was not found");

  await updateSavedOpportunity(opportunityId, { status: "pursuing" });
  const pursuitSnapshot = await ensurePursuitSnapshotPrepared(opportunityId);

  await db
    .insert(bidWorkspaces)
    .values({
      opportunityId,
      companyProfileId: null,
      title: opportunity.title,
      status: "draft",
      sourceSnapshot: {
        pursuitSnapshotId: pursuitSnapshot.id,
        documentSetFingerprint: pursuitSnapshot.documentSetFingerprint,
        snapshotStatus: pursuitSnapshot.status,
        stale: false,
      },
      metadata: { reviewState: "not_started" },
    })
    .onConflictDoNothing();

  const [workspace] = await db
    .select({ id: bidWorkspaces.id })
    .from(bidWorkspaces)
    .where(
      and(
        eq(bidWorkspaces.opportunityId, opportunityId),
        isNull(bidWorkspaces.companyProfileId),
      ),
    )
    .orderBy(asc(bidWorkspaces.createdAt))
    .limit(1);
  if (!workspace) throw new Error("Bid workspace could not be created");

  await db
    .update(pursuitDocumentSnapshots)
    .set({ bidWorkspaceId: workspace.id, updatedAt: new Date() })
    .where(eq(pursuitDocumentSnapshots.id, pursuitSnapshot.id));

  const loaded = await getBidWorkspace(workspace.id);
  if (!loaded) throw new Error("Bid workspace could not be loaded");
  return loaded;
}

export async function updateBidWorkspace(
  workspaceId: string,
  input: UpdateBidWorkspaceInput,
): Promise<BidWorkspaceRecord> {
  if (input.status !== undefined && !isBidWorkspaceStatus(input.status)) {
    throw new Error("Invalid bid workspace status");
  }
  if (
    input.reviewState !== undefined &&
    !isBidWorkspaceReviewState(input.reviewState)
  ) {
    throw new Error("Invalid bid workspace review state");
  }
  if (input.notes !== undefined && input.notes !== null && input.notes.length > 20_000) {
    throw new Error("Bid workspace notes are too long");
  }
  if (input.confirmedOriginalForms !== undefined && (
    !Array.isArray(input.confirmedOriginalForms) ||
    input.confirmedOriginalForms.some((id) => typeof id !== "string") ||
    new Set(input.confirmedOriginalForms).size !== input.confirmedOriginalForms.length
  )) {
    throw new Error("Original source form confirmations must be a unique array of requirement ids");
  }

  const row = await selectWorkspace(workspaceId);
  if (!row) throw new Error("Bid workspace was not found");

  const loaded = await getBidWorkspace(workspaceId);
  if (!loaded) throw new Error("Bid workspace was not found");
  if (input.confirmedOriginalForms !== undefined) {
    const validIds = new Set(loaded.finalReview.sourceChecks
      .filter((check) => check.originalRequired).map((check) => check.requirementId));
    if (input.confirmedOriginalForms.some((id) => !validIds.has(id))) {
      throw new Error("Original form confirmation does not match a current mandatory source form");
    }
  }
  if ((input.status === "complete" || input.reviewState === "approved") &&
      !loaded.finalReview.readyForHumanReview) {
    throw new Error("Resolve every final-review blocker before marking this bid complete or approved");
  }
  if (input.reviewState === "approved" && input.humanReviewConfirmed !== true) {
    throw new Error("Explicit personal review confirmation is required before approval");
  }
  if (input.reviewState === "approved" && input.confirmedOriginalForms !== undefined) {
    throw new Error("Save original form confirmations before completing human review");
  }

  const current = metadataState(row.metadata ?? {});
  const metadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    reviewState: input.reviewState ?? current.reviewState,
  };
  if (input.notes !== undefined) {
    const notes = input.notes?.trim() || null;
    if (notes) metadata.notes = notes;
    else delete metadata.notes;
  }
  if (input.confirmedOriginalForms !== undefined) {
    metadata.confirmedOriginalForms = input.confirmedOriginalForms;
    metadata.originalFormsFingerprint = loaded.sourceSnapshot.documentSetFingerprint;
    delete metadata.finalReviewApprovalFingerprint;
    if (metadata.reviewState === "approved") metadata.reviewState = "needs_changes";
  }
  if (input.reviewState === "approved") {
    metadata.finalReviewApprovalFingerprint = loaded.finalReview.reviewFingerprint;
  } else if (input.reviewState !== undefined) {
    delete metadata.finalReviewApprovalFingerprint;
  }

  const db = getDb();
  await db
    .update(bidWorkspaces)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(bidWorkspaces.id, workspaceId));

  const updated = await getBidWorkspace(workspaceId);
  if (!updated) throw new Error("Bid workspace could not be loaded");
  return updated;
}
