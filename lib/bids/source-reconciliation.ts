import type { BidWorkspaceSourceSnapshot } from "@/lib/bids/workspace";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

type ReconciliationInput = {
  snapshot: BidWorkspaceSourceSnapshot;
  requirements: {
    isStale:boolean;
    completenessStatus:"complete" | "partial";
    requirements:Array<Pick<PersistedSolicitationRequirement,"requirementKey" | "evidence" | "listingEvidence">>;
  } | null;
  previousDocumentVersionIds: string[];
  understandingInputVersionIds: string[];
};

export type BidSourceReconciliationAssessment =
  | { state:"ready"; addedDocumentVersionIds:string[]; removedDocumentVersionIds:string[] }
  | { state:"blocked"; reason:string };

/** Deliberately pure. A new source package requires a new explicit understanding cycle
 * that actually saw all current versions; a checkbox alone cannot make evidence current. */
export function assessBidSourceReconciliation(input:ReconciliationInput):BidSourceReconciliationAssessment {
  const {snapshot,requirements,previousDocumentVersionIds,understandingInputVersionIds}=input;
  const current=snapshot.documents.map((document)=>document.opportunityDocumentVersionId);
  if (!snapshot.pursuitSnapshotId || snapshot.snapshotStatus!=="complete" ||
    snapshot.storedDocumentCount!==snapshot.totalDocumentCount || !current.length ||
    current.length!==snapshot.totalDocumentCount ||
    snapshot.documents.some((document)=>document.status!=="stored" || !document.checksumSha256)) {
    return {state:"blocked",reason:"Retain every original source file before reconciling the bid."};
  }
  if (!snapshot.documentSetFingerprint || snapshot.documentSetFingerprint!==snapshot.currentDocumentSetFingerprint) {
    return {state:"blocked",reason:"The authoritative source inventory changed again. Refresh the immutable snapshot first."};
  }
  if (!requirements || requirements.isStale || requirements.completenessStatus!=="complete" ||
    !requirements.requirements.length) {
    return {state:"blocked",reason:"Explicitly regenerate and review a complete current solicitation understanding before reconciling this bid."};
  }
  const inputs=new Set(understandingInputVersionIds);
  if (inputs.size!==current.length || current.some((id)=>!inputs.has(id))) {
    return {state:"blocked",reason:"The saved understanding did not process every current source document. Request a new manual understanding cycle."};
  }
  const ids=new Set(current);
  for (const requirement of requirements.requirements) {
    if (!requirement.evidence.length && !requirement.listingEvidence) {
      return {state:"blocked",reason:`Source requirement ${requirement.requirementKey} lacks verified authoritative evidence.`};
    }
    if (requirement.evidence.some((evidence)=>!ids.has(evidence.opportunityDocumentVersionId) ||
      !evidence.excerpt?.trim())) {
      return {state:"blocked",reason:`Source requirement ${requirement.requirementKey} refers to missing or superseded document evidence.`};
    }
  }
  const previous=new Set(previousDocumentVersionIds);
  const added=current.filter((id)=>!previous.has(id));
  const removed=previousDocumentVersionIds.filter((id)=>!ids.has(id));
  for (const versionId of added) {
    if (!requirements.requirements.some((requirement)=>requirement.evidence.some((evidence)=>
      evidence.opportunityDocumentVersionId===versionId && Boolean(evidence.excerpt?.trim())))) {
      return {state:"blocked",reason:"A newly discovered source document has no verifiable requirement evidence. Review and regenerate understanding manually."};
    }
  }
  return {state:"ready",addedDocumentVersionIds:added,removedDocumentVersionIds:removed};
}
