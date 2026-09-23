import { and, eq, sql } from "drizzle-orm";

import { planBidOutline } from "@/lib/bids/outline";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { assessBidSourceReconciliation } from "@/lib/bids/source-reconciliation";
import { bidSections, bidWorkspaces } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";
import { solicitationUnderstandingInputs } from "@/lib/db/solicitation-understandings-schema";
import {
  getCurrentOpportunityDocumentSetFingerprint,
  getPursuitSnapshot,
} from "@/lib/procurement/pursuits/snapshot";
import { generateBidComplianceMatrix } from "@/lib/bids/compliance-persistence";

/**
 * Manual, deterministic finalization after the user reviewed every original file
 * and separately requested a new understanding when sources changed. This function
 * deliberately contains no AI/provider calls or source download side effects.
 */
export async function reconcileBidSource(workspaceId:string, reviewedDocumentVersionIds:string[]) {
  const workspace=await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  const snapshot=workspace.sourceSnapshot;
  const source=workspace.sourceRequirements;
  const currentIds=snapshot.documents.map((document)=>document.opportunityDocumentVersionId);
  if (reviewedDocumentVersionIds.length!==currentIds.length ||
    new Set(reviewedDocumentVersionIds).size!==currentIds.length ||
    currentIds.some((id)=>!reviewedDocumentVersionIds.includes(id))) {
    throw new Error("Review and confirm each original document in the current source snapshot before reconciling.");
  }

  const prior=snapshot.supersedesSnapshotId
    ? await getPursuitSnapshot(snapshot.supersedesSnapshotId) : null;
  const inputRows=source ? await getDb().select({
    id:solicitationUnderstandingInputs.opportunityDocumentVersionId,
  }).from(solicitationUnderstandingInputs).where(eq(
    solicitationUnderstandingInputs.solicitationUnderstandingId,source.understandingId,
  )) : [];
  const assessment=assessBidSourceReconciliation({
    snapshot,requirements:source,
    previousDocumentVersionIds:prior?.documents.map((document)=>document.opportunityDocumentVersionId)??currentIds,
    understandingInputVersionIds:inputRows.map((row)=>row.id),
  });
  if (assessment.state==="blocked") throw new Error(assessment.reason);
  if (!source) throw new Error("Current understanding is unavailable.");
  const planned=planBidOutline(source.requirements);
  const plannedByKey=new Map(planned.map((section)=>[section.metadata.outlineKey,section]));
  const currentSourceFp=await getCurrentOpportunityDocumentSetFingerprint(workspace.opportunityId);
  if (currentSourceFp!==snapshot.documentSetFingerprint) {
    throw new Error("Source files changed during review. Refresh the authoritative inventory.");
  }

  const db=getDb();
  await db.transaction(async(tx)=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const [row]=await tx.select({sourceSnapshot:bidWorkspaces.sourceSnapshot})
      .from(bidWorkspaces).where(eq(bidWorkspaces.id,workspaceId)).limit(1);
    if (!row || row.sourceSnapshot.pursuitSnapshotId!==snapshot.pursuitSnapshotId ||
      row.sourceSnapshot.documentSetFingerprint!==snapshot.documentSetFingerprint) {
      throw new Error("The source snapshot changed while reconciling. Refresh the workspace.");
    }
    // Preserve the original immutable snapshots and previously saved human responses.
    const saved=await tx.select().from(bidSections).where(eq(bidSections.bidWorkspaceId,workspaceId));
    const matched=new Set<string>();
    for (const section of saved) {
      const key=typeof section.metadata.outlineKey==="string"?section.metadata.outlineKey:null;
      const next=key?plannedByKey.get(key):null;
      if (!next) continue; // Unknown custom section stays pinned to its old understanding, requiring review.
      matched.add(key!);
      const isUnedited=!(section.content?.trim()) &&
        section.title===next.title &&
        section.metadata.generatorVersion==="deterministic-v1";
      const metadata={
        ...section.metadata,
        understandingId:source.understandingId,
        understandingStale:false,
        completenessStatus:source.completenessStatus,
        pursuitSnapshotId:snapshot.pursuitSnapshotId,
        documentSetFingerprint:snapshot.documentSetFingerprint,
        snapshotStatus:snapshot.snapshotStatus,
        snapshotStale:false,
        sourceReviewRequired:!isUnedited,
        sourceReconciledAt:new Date().toISOString(),
      };
      delete metadata.verifiedVendorFactsFingerprint;
      await tx.update(bidSections).set({
        requirementLinks:next.requirementLinks,
        ...(isUnedited?{instructions:next.instructions}:{}),
        metadata,
        updatedAt:new Date(),
      }).where(and(eq(bidSections.id,section.id),eq(bidSections.bidWorkspaceId,workspaceId)));
    }
    const missing=planned.filter((section)=>!matched.has(section.metadata.outlineKey));
    if (missing.length) await tx.insert(bidSections).values(missing.map((section)=>({
      bidWorkspaceId:workspaceId,...section,
      sortOrder:saved.length+section.sortOrder,
      metadata:{
        ...section.metadata,generatorVersion:"deterministic-v1",
        understandingId:source.understandingId,understandingStale:false,
        completenessStatus:source.completenessStatus,
        pursuitSnapshotId:snapshot.pursuitSnapshotId,
        documentSetFingerprint:snapshot.documentSetFingerprint,
        snapshotStatus:snapshot.snapshotStatus,snapshotStale:false,
      },
    })));
    const updated=await tx.update(bidWorkspaces).set({
      sourceSnapshot:{
        ...row.sourceSnapshot,
        pursuitSnapshotId:snapshot.pursuitSnapshotId,
        documentSetFingerprint:snapshot.documentSetFingerprint,
        snapshotStatus:"complete",stale:false,staleReason:null,
      },
      metadata:{...workspace.metadata,reviewState:"not_started"},
      updatedAt:new Date(),
    }).where(and(eq(bidWorkspaces.id,workspaceId),
      sql`${bidWorkspaces.sourceSnapshot}->>'pursuitSnapshotId' = ${snapshot.pursuitSnapshotId}`,
      sql`${bidWorkspaces.sourceSnapshot}->>'documentSetFingerprint' = ${snapshot.documentSetFingerprint}`,
    )).returning({id:bidWorkspaces.id});
    if (!updated.length) throw new Error("The authoritative source changed during reconciliation.");
  });
  // Only add new compliance rows. Previous responses and their historic provenance
  // remain attached to the old snapshot and cannot automatically become complete.
  await generateBidComplianceMatrix(workspaceId);
  const refreshed=await getBidWorkspace(workspaceId);
  if (!refreshed || refreshed.sourceSnapshot.stale || refreshed.sourceRequirements?.isStale) {
    throw new Error("The source changed during reconciliation. Recheck the original files.");
  }
  return refreshed;
}
