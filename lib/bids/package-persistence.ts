import { eq, sql } from "drizzle-orm";

import { assessFullBidGenerationReadiness } from "@/lib/bids/full-bid";
import { getFullBidArtifact } from "@/lib/bids/full-bid-persistence";
import {
  bidPackageFingerprint,
  buildBidPackageManifest,
  buildBidPackageTar,
  evaluateBidPackageReadiness,
  isBidPackageApprovalCurrent,
  type BidPackageApproval,
} from "@/lib/bids/package";
import { getBidSupportingChecklist } from "@/lib/bids/supporting-items-persistence";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { bidWorkspaces } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseApproval(value: unknown): BidPackageApproval | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.fingerprint === "string" && typeof row.approvedAt === "string"
    ? { fingerprint: row.fingerprint, approvedAt: row.approvedAt }
    : null;
}

async function loadWorkspaceMetadata(workspaceId: string) {
  const [row] = await getDb().select({ metadata: bidWorkspaces.metadata })
    .from(bidWorkspaces).where(eq(bidWorkspaces.id, workspaceId)).limit(1);
  return row?.metadata ?? null;
}

export async function getBidPackageStatus(workspaceId: string) {
  if (!UUID.test(workspaceId)) throw new Error("Bid workspace id is invalid.");
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const [artifact, supportingChecklist, metadata] = await Promise.all([
    getFullBidArtifact(workspaceId),
    getBidSupportingChecklist(workspaceId),
    loadWorkspaceMetadata(workspaceId),
  ]);
  const sourceReadiness = assessFullBidGenerationReadiness({
    snapshot: workspace.sourceSnapshot,
    requirements: workspace.sourceRequirements,
  });
  const readiness = evaluateBidPackageReadiness({
    content: artifact?.content ?? null,
    sourceReady: sourceReadiness.ready,
    sourceBlockers: sourceReadiness.blockers,
    sourceFingerprint: workspace.sourceSnapshot.documentSetFingerprint,
    understandingId: workspace.sourceRequirements?.understandingId ?? null,
    supportingChecklist,
  });
  const approval = parseApproval(metadata?.bidPackageApproval);
  const approvalCurrent = readiness.readyForApproval &&
    isBidPackageApprovalCurrent(approval, readiness.packageFingerprint);
  const instructions = workspace.sourceRequirements?.requirements
    .filter((requirement) => requirement.type === "submission_instruction")
    .map((requirement) => requirement.text.trim())
    .filter(Boolean) ?? [];
  return {
    readyForApproval: readiness.readyForApproval,
    blockers: readiness.blockers,
    packageFingerprint: readiness.packageFingerprint,
    approvalCurrent,
    approvedAt: approvalCurrent ? approval?.approvedAt ?? null : null,
    supportingChecklist,
    source: {
      snapshotId: workspace.sourceSnapshot.pursuitSnapshotId,
      documentSetFingerprint: workspace.sourceSnapshot.documentSetFingerprint,
      understandingId: workspace.sourceRequirements?.understandingId ?? null,
    },
    submission: {
      url: workspace.submissionUrl,
      instructions,
    },
    workspace: {
      id: workspace.id,
      opportunityId: workspace.opportunityId,
      title: workspace.title,
    },
  };
}

export async function approveBidPackage(workspaceId: string) {
  const status = await getBidPackageStatus(workspaceId);
  if (!status.readyForApproval) {
    throw new Error(status.blockers[0]?.message ?? "Resolve package blockers before approval.");
  }
  const approvedAt = new Date().toISOString();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`package-approval:${workspaceId}`}))`);
    const [row] = await tx.select({ metadata: bidWorkspaces.metadata })
      .from(bidWorkspaces).where(eq(bidWorkspaces.id, workspaceId)).limit(1);
    if (!row) throw new Error("Bid workspace was not found.");
    await tx.update(bidWorkspaces).set({
      metadata: {
        ...(row.metadata ?? {}),
        bidPackageApproval: {
          fingerprint: status.packageFingerprint,
          approvedAt,
        },
      },
      updatedAt: new Date(),
    }).where(eq(bidWorkspaces.id, workspaceId));
  });
  const updated = await getBidPackageStatus(workspaceId);
  if (!updated.approvalCurrent) {
    throw new Error("The saved bid changed during approval. Review the current response and approve it again.");
  }
  return updated;
}

export async function buildApprovedBidPackage(workspaceId: string) {
  const status = await getBidPackageStatus(workspaceId);
  if (!status.approvalCurrent || !status.approvedAt) {
    throw new Error("Review and approve the exact saved bid before downloading the final package.");
  }
  const artifact = await getFullBidArtifact(workspaceId);
  const content = artifact?.content ?? "";
  const currentFingerprint = bidPackageFingerprint({
    content,
    sourceFingerprint: status.source.documentSetFingerprint,
    understandingId: status.source.understandingId,
    supportingChecklist: status.supportingChecklist,
  });
  if (currentFingerprint !== status.packageFingerprint) {
    throw new Error("The saved bid changed before packaging. Review and approve the exact saved bid again.");
  }
  const manifest = buildBidPackageManifest({
    workspaceId: status.workspace.id,
    opportunityId: status.workspace.opportunityId,
    title: status.workspace.title,
    content,
    packageFingerprint: status.packageFingerprint,
    approvedAt: status.approvedAt,
    snapshotId: status.source.snapshotId,
    sourceFingerprint: status.source.documentSetFingerprint,
    understandingId: status.source.understandingId,
    supportingChecklist: status.supportingChecklist,
    submission: status.submission,
  });
  return {
    filename: "govtract-bid-package.tar",
    bytes: buildBidPackageTar(content, manifest),
    manifest,
  };
}
