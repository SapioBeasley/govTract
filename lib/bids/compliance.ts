import type { BidWorkspaceSourceSnapshot } from "./workspace";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

export const COMPLIANCE_STATUSES = [
  "missing",
  "drafting",
  "complete",
  "needs_review",
  "not_applicable",
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export function isComplianceStatus(value: unknown): value is ComplianceStatus {
  return typeof value === "string" && COMPLIANCE_STATUSES.some((status) => status === value);
}

export type ComplianceEvidenceReference = {
  snapshotDocumentId: string | null;
  opportunityDocumentVersionId: string;
  filename: string | null;
  checksumSha256: string | null;
  documentExtractionSegmentId: string | null;
  locator: Record<string, unknown>;
  excerpt: string | null;
};

export type ComplianceEvidence = {
  understandingId: string;
  sourceRequirementId: string;
  sourceFindingKey: string;
  pursuitSnapshotId: string | null;
  references: ComplianceEvidenceReference[];
  issues: string[];
};

export type PlannedComplianceRequirement = {
  sourceRequirementKey: string;
  requirementType: string;
  text: string;
  isRequired: boolean;
  status: ComplianceStatus;
  evidence: ComplianceEvidence;
  sortOrder: number;
};

export function isComplianceEvidence(value: unknown): value is ComplianceEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return (
    typeof evidence.understandingId === "string" &&
    typeof evidence.sourceRequirementId === "string" &&
    typeof evidence.sourceFindingKey === "string" &&
    (typeof evidence.pursuitSnapshotId === "string" || evidence.pursuitSnapshotId === null) &&
    Array.isArray(evidence.references) &&
    Array.isArray(evidence.issues)
  );
}

/**
 * Deterministic conversion of an already-persisted understanding. No model call or source
 * retrieval is permitted here: missing source evidence remains explicitly unverified.
 */
export function planComplianceMatrix(input: {
  understandingId: string;
  requirements: PersistedSolicitationRequirement[];
  completenessStatus: "complete" | "partial";
  understandingStale: boolean;
  snapshot: BidWorkspaceSourceSnapshot;
}): PlannedComplianceRequirement[] {
  const { snapshot } = input;
  const snapshotDocuments = new Map(
    snapshot.documents.map((document) => [document.opportunityDocumentVersionId, document]),
  );

  return input.requirements.map((requirement, sortOrder) => {
    const issues = new Set<string>();
    if (input.completenessStatus !== "complete") issues.add("requirement_set_incomplete");
    if (input.understandingStale) issues.add("understanding_stale");
    if (!snapshot.pursuitSnapshotId || snapshot.snapshotStatus !== "complete") {
      issues.add("snapshot_incomplete");
    }
    if (snapshot.stale || snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint) {
      issues.add("authoritative_document_set_changed");
    }
    if (requirement.evidence.length === 0) issues.add("requirement_evidence_missing");

    const references = requirement.evidence.map((evidence) => {
      const document = snapshotDocuments.get(evidence.opportunityDocumentVersionId);
      if (!document) issues.add("document_version_outside_snapshot");
      else if (document.status !== "stored") issues.add("evidence_document_unavailable");

      return {
        snapshotDocumentId: document?.id ?? null,
        opportunityDocumentVersionId: evidence.opportunityDocumentVersionId,
        filename: document?.filename ?? null,
        checksumSha256: document?.checksumSha256 ?? null,
        documentExtractionSegmentId: evidence.documentExtractionSegmentId,
        locator: evidence.locator,
        excerpt: evidence.excerpt,
      };
    });

    return {
      sourceRequirementKey: `${input.understandingId}:${requirement.id}`,
      requirementType: requirement.type,
      text: requirement.text,
      isRequired: requirement.level !== "optional",
      status: issues.size > 0 ? "needs_review" : "missing",
      evidence: {
        understandingId: input.understandingId,
        sourceRequirementId: requirement.id,
        sourceFindingKey: requirement.sourceFindingKey,
        pursuitSnapshotId: snapshot.pursuitSnapshotId,
        references,
        issues: [...issues],
      },
      sortOrder,
    };
  });
}

/**
 * Effective status is never allowed to mask a changed or unverifiable source set.
 * The original user response status and evidence are preserved in the database.
 */
export function resolveComplianceStatus(
  savedStatus: string,
  evidence: ComplianceEvidence,
  snapshot: BidWorkspaceSourceSnapshot,
  currentUnderstandingId: string | null,
): ComplianceStatus {
  if (
    !isComplianceStatus(savedStatus) ||
    !snapshot.pursuitSnapshotId ||
    snapshot.snapshotStatus !== "complete" ||
    snapshot.stale ||
    snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint ||
    evidence.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
    evidence.understandingId !== currentUnderstandingId ||
    evidence.issues.length > 0 ||
    evidence.references.length === 0
  ) return "needs_review";

  const snapshotDocuments = new Map(snapshot.documents.map((document) => [document.id, document]));
  if (evidence.references.some((reference) => {
    const document = reference.snapshotDocumentId
      ? snapshotDocuments.get(reference.snapshotDocumentId)
      : null;
    return !document ||
      document.status !== "stored" ||
      document.opportunityDocumentVersionId !== reference.opportunityDocumentVersionId ||
      document.checksumSha256 !== reference.checksumSha256;
  })) return "needs_review";

  return savedStatus;
}
