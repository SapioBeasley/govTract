import { and, eq } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import {
  isComplianceEvidence,
  isComplianceStatus,
  planComplianceMatrix,
  resolveComplianceStatus,
  shouldRefreshUnverifiedComplianceEvidence,
  type ComplianceStatus,
} from "@/lib/bids/compliance";
import { bidRequirements } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

export type UpdateComplianceRequirementInput = {
  status?: ComplianceStatus;
  responseNotes?: string | null;
};

/**
 * Explicit deterministic action; it reuses persisted understanding and never calls AI.
 * Conflict-safe inserts do not overwrite response progress or pinned historical evidence.
 */
export async function generateBidComplianceMatrix(workspaceId: string) {
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  const source = workspace.sourceRequirements;
  if (!source || source.requirements.length === 0) {
    throw new Error("Structured solicitation requirements are not available yet.");
  }

  const planned = planComplianceMatrix({
    understandingId: source.understandingId,
    requirements: source.requirements,
    completenessStatus: source.completenessStatus,
    understandingStale: source.isStale,
    snapshot: workspace.sourceSnapshot,
  });

  const db = getDb();
  await db
    .insert(bidRequirements)
    .values(planned.map((requirement) => ({
      bidWorkspaceId: workspaceId,
      ...requirement,
    })))
    .onConflictDoNothing();

  // Existing workspaces generated a matrix while citations were missing.
  // Repair ONLY needs_review rows on the very same immutable snapshot after
  // actual source provenance becomes verifiable. Preserve response notes,
  // user-approved statuses and historical citations across amendments.
  const plannedByKey = new Map(planned.map((row) => [row.sourceRequirementKey,row]));
  for (const saved of workspace.requirements) {
    const next = plannedByKey.get(saved.sourceRequirementKey ?? "");
    if (!next || !isComplianceEvidence(saved.evidence)) continue;
    if (!shouldRefreshUnverifiedComplianceEvidence({
      savedStatus:saved.status,
      savedSnapshotId:saved.evidence.pursuitSnapshotId,
      currentSnapshotId:workspace.sourceSnapshot.pursuitSnapshotId,
      savedIssues:saved.evidence.issues,
      plannedIssues:next.evidence.issues,
    })) continue;
    await db.update(bidRequirements).set({
      evidence:next.evidence,
      updatedAt:new Date(),
    }).where(and(
      eq(bidRequirements.id,saved.id),
      eq(bidRequirements.bidWorkspaceId,workspaceId),
      eq(bidRequirements.status,"needs_review"),
    ));
  }
  return getBidWorkspace(workspaceId);
}

export async function updateBidComplianceRequirement(
  workspaceId: string,
  requirementId: string,
  input: UpdateComplianceRequirementInput,
) {
  if (input.status !== undefined && !isComplianceStatus(input.status)) {
    throw new Error("Invalid compliance response status");
  }
  if (
    input.responseNotes !== undefined &&
    input.responseNotes !== null &&
    (typeof input.responseNotes !== "string" || input.responseNotes.length > 10_000)
  ) {
    throw new Error("Compliance response notes are invalid or too long");
  }
  if (input.status === undefined && input.responseNotes === undefined) {
    throw new Error("A compliance status or response note is required");
  }

  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  const requirement = workspace.requirements.find((row) => row.id === requirementId);
  if (!requirement) throw new Error("Bid requirement was not found");

  if (input.status === "complete") {
    if (
      !isComplianceEvidence(requirement.evidence) ||
      workspace.sourceRequirements?.completenessStatus !== "complete" ||
      workspace.sourceRequirements.isStale ||
      resolveComplianceStatus(
        "complete",
        requirement.evidence,
        workspace.sourceSnapshot,
        workspace.sourceRequirements.understandingId,
        workspace.sourceRequirements.requirements.find((source) =>
          source.id === requirement.evidence.sourceRequirementId)?.listingEvidence ?? null,
      ) !== "complete"
    ) {
      throw new Error("Review the current solicitation and source evidence before marking this requirement complete");
    }
  }

  const db = getDb();
  await db
    .update(bidRequirements)
    .set({
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.responseNotes === undefined
        ? {}
        : { responseNotes: input.responseNotes?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bidRequirements.id, requirementId),
        eq(bidRequirements.bidWorkspaceId, workspaceId),
      ),
    );

  return getBidWorkspace(workspaceId);
}
