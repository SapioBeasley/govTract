import { createHash } from "node:crypto";

import { reviewDraftFingerprint } from "@/lib/bids/draft-guardrails";
import { responseEvidenceIsCurrent } from "@/lib/bids/response-proof";
import { isComplianceEvidence } from "@/lib/bids/compliance";

import type { BidWorkspaceRecord } from "@/lib/bids/workspace";
import type { ListingEvidence } from "@/lib/procurement/requirements/listing-evidence";
import { isAgencyBaselineRequirement } from "@/lib/procurement/documents/roles";

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
  "sourceSnapshot" | "sourceRequirements" | "requirements" | "sections" | "dueAt"
> & { agencyBaselineReviewCurrent?: boolean };

export type FinalReviewInput = {
  workspace: ReviewWorkspace;
  portalUrl: string | null;
  confirmedOriginalForms?: string[];
  now?: Date;
};

const submissionTypes = new Set([
  "submission_instruction", "deadline", "form", "pricing", "certification",
  "bonding", "insurance", "insurance_bonding",
]);

function originalFormRequired(type: string, text: string, details: Record<string, unknown>) {
  if (details.requiredOriginalForm === true || details.templateRequired === true) return true;
  if (type === "form") return true;
  if (type === "submission_instruction") {
    return /\\b(?:original (?:form|template)|provided (?:form|template))\\b/i.test(text);
  }
  return (type === "pricing" || type === "certification") &&
    /\\b(?:original (?:form|template)|pricing (?:sheet|worksheet|form)|(?:signed|completed) (?:form|affidavit)|provided (?:form|template))\\b/i.test(text);
}

function explicitOriginalFileNames(details: Record<string, unknown>, text: string, filenames: string[]) {
  const fields = ["requiredFileName", "formFilename", "templateFilename", "sourceFileName"];
  const named = fields.flatMap((field) => typeof details[field] === "string" ? [details[field] as string] : []);
  return filenames.filter((filename) =>
    named.some((name) => name.trim().toLowerCase() === filename.toLowerCase()) ||
    text.toLowerCase().includes(filename.toLowerCase()),
  );
}

function hasUnresolvedPlaceholder(content: string) {
  return /\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\b(?:TODO|TBD)\s*[:\-]|\{\{[^}]+\}\}|<<[^>]+>>/i.test(content);
}

/**
 * Read-only final review. A complete checklist only permits human review of a package;
 * it never records a bid as submitted and never uses an AI-generated source substitute.
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
      snapshot.blockedDocumentCount > 0 || snapshot.failedDocumentCount > 0) {
    issue("source_snapshot_incomplete", "The complete authoritative source package has not been retained.");
  }
  if (snapshot.stale || !snapshot.documentSetFingerprint ||
      snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint) {
    issue("source_snapshot_stale", "An authoritative document or amendment changed after this bid snapshot.");
  }
  for (const document of snapshot.documents) {
    if (document.status !== "stored" || !document.checksumSha256) {
      issue("source_document_unavailable",
        `Original source file ${document.filename} is not reliably retained (${document.status}).`,
        { documentId: document.id });
    }
  }
  if (snapshot.documents.length !== snapshot.totalDocumentCount) {
    issue("source_document_inventory_incomplete", "The source document inventory does not match the captured package.");
  }
  const currentChecks = source?.requirements.map((requirement) => workspace.requirements.find((row) =>
    row.sourceRequirementKey === `${source.understandingId}:${requirement.id}`)) ?? [];
  const reviewedSourceSet = Boolean(source && source.requirements.length > 0 &&
    source.completenessStatus === "partial" &&
    source.incompleteReasons.length > 0 &&
    source.incompleteReasons.every((reason) => reason === "requirement_evidence_missing") &&
    currentChecks.every((row) => row?.canMarkComplete));
  if (!source || (source.completenessStatus !== "complete" && !reviewedSourceSet) || source.isStale ||
      !source.requirements.length) {
    issue("source_requirements_unverified", "A complete current structured solicitation requirement set is unavailable.");
  }
  if (!portalUrl || !/^https:\/\/[^\s/]+(?:\/|$)/i.test(portalUrl)) {
    issue("submission_portal_unverified", "Confirm the authoritative external solicitation and submission channel.");
  }
  if (!workspace.dueAt) {
    issue("submission_deadline_unverified", "The authoritative submission due date and time must be confirmed.");
  } else if (workspace.dueAt.getTime() <= (input.now ?? new Date()).getTime()) {
    issue("submission_deadline_elapsed", "The recorded submission deadline has passed; verify any extension at the source.");
  }

  const byVersion = new Map(snapshot.documents.map((document) => [
    document.opportunityDocumentVersionId, document,
  ]));
  const byKey = new Map(workspace.requirements.map((requirement) => [
    requirement.sourceRequirementKey, requirement,
  ]));
  if (!workspace.requirements.length) {
    issue("compliance_matrix_missing", "Generate and review the bid compliance matrix.");
  }
  const agencyBaselineRequirements = source?.requirements.filter(isAgencyBaselineRequirement) ?? [];
  if (agencyBaselineRequirements.length && !workspace.agencyBaselineReviewCurrent) {
    issue(
      "agency_baseline_terms_unreviewed",
      "Review the current standard agency terms once before final bid approval.",
    );
  }

  const sourceChecks: FinalReviewSourceCheck[] = [];
  const submissionInstructions: string[] = [];
  for (const requirement of source?.requirements ?? []) {
    const agencyBaseline = isAgencyBaselineRequirement(requirement);
    const response = byKey.get(`${source!.understandingId}:${requirement.id}`);
    const effectiveEvidence = response && isComplianceEvidence(response.evidence) &&
      response.evidence.understandingId === source!.understandingId &&
      response.evidence.sourceRequirementId === requirement.id
        ? response.evidence : null;
    const level = effectiveEvidence?.requirementLevel ?? requirement.level;
    const mandatory = level === "required";
    const references = (effectiveEvidence?.references.length
      ? effectiveEvidence.references : requirement.evidence).map((evidence) => {
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
    if (level === "unknown") {
      issue("requiredness_unverified", `Verify whether this source requirement is mandatory: ${requirement.text}`,
        { requirementId: requirement.id });
    }
    const responseCurrent = response && responseEvidenceIsCurrent(
      response.responseEvidence, workspace.sections, input.confirmedOriginalForms ?? [],
      requirement.type, requirement.id, {
        snapshotId: snapshot.pursuitSnapshotId,
        fingerprint: snapshot.documentSetFingerprint,
        understandingId: source!.understandingId,
      },
    );
    if (!agencyBaseline && mandatory &&
        (!response || response.effectiveStatus !== "complete" || !responseCurrent)) {
      issue("mandatory_requirement_incomplete",
        `Mandatory requirement needs current saved bid-response evidence or a confirmed original form: ${requirement.text}`,
        { requirementId: requirement.id });
    }
    if ((mandatory || submissionTypes.has(requirement.type)) &&
        ((!references.length && !requirement.listingEvidence) || references.some((reference) =>
          !reference.snapshotDocumentId || !reference.checksumSha256 || !reference.excerpt?.trim() ||
          byVersion.get(reference.opportunityDocumentVersionId)?.status !== "stored"))) {
      issue("source_evidence_unverified", `Source evidence cannot be verified against the retained version: ${requirement.text}`,
        { requirementId: requirement.id });
    }

    if (requirement.type === "submission_instruction") submissionInstructions.push(requirement.text);
    if (!submissionTypes.has(requirement.type)) continue;

    const originalRequired = mandatory &&
      originalFormRequired(requirement.type, requirement.text, requirement.details);
    const identifiedNames = originalRequired
      ? explicitOriginalFileNames(requirement.details, requirement.text,
          snapshot.documents.map((document) => document.filename))
      : [];
    const originalDocuments = snapshot.documents.filter((document) =>
      identifiedNames.includes(document.filename)).map((document) => ({
        id: document.id,
        filename: document.filename,
        opportunityDocumentVersionId: document.opportunityDocumentVersionId,
        checksumSha256: document.checksumSha256,
        status: document.status,
      }));
    if (originalRequired && !originalDocuments.length) {
      issue("original_form_not_identified",
        `Identify the required original source template/form, not a generated replacement: ${requirement.text}`,
        { requirementId: requirement.id });
    }
    if (originalRequired && !confirmed.has(requirement.id)) {
      issue("original_form_unconfirmed",
        `Confirm that the original source form is completed and included for external upload: ${requirement.text}`,
        { requirementId: requirement.id });
    }
    sourceChecks.push({
      requirementId: requirement.id,
      text: requirement.text,
      kind: requirement.type,
      mandatory,
      responseStatus: response?.effectiveStatus ?? "missing",
      originalRequired,
      originalConfirmed: confirmed.has(requirement.id),
      originalDocuments,
      references,
      listingEvidence: requirement.listingEvidence ?? null,
    });
  }
  if (!submissionInstructions.length) {
    issue("submission_method_unverified", "Submission method and file requirements must be reviewed in authoritative instructions.");
  }

  if (!workspace.sections.length) {
    issue("response_sections_missing", "Generate and review the required response sections.");
  }
  for (const section of workspace.sections) {
    if (section.metadata.aiDraftReview &&
        section.metadata.verifiedVendorFactsFingerprint !== reviewDraftFingerprint(
          section.content ?? "", snapshot.documentSetFingerprint,
        )) {
      issue("ai_vendor_facts_unverified",
        "AI draft " + section.title + ": verify offered make/model, model-specific loads and test weights, certifications, testing, warranty, delivery, pricing, insurance and company capacity; resolve placeholders and explicitly confirm the exact saved text before final review.",
        { sectionId: section.id });
    }
    if (!section.content?.trim()) {
      issue("section_incomplete", `Response section ${section.title} is empty.`, { sectionId: section.id });
    } else if (hasUnresolvedPlaceholder(section.content)) {
      issue("section_placeholder", `Response section ${section.title} contains an unresolved placeholder.`,
        { sectionId: section.id });
    }
    if (section.metadata.snapshotStale === true ||
        section.metadata.understandingStale === true ||
        (typeof section.metadata.documentSetFingerprint === "string" &&
          section.metadata.documentSetFingerprint !== snapshot.documentSetFingerprint)) {
      issue("section_source_stale", `Response section ${section.title} was prepared against stale source evidence.`,
        { sectionId: section.id });
    }
  }

  const reviewFingerprint = createHash("sha256").update(JSON.stringify({
    snapshot: snapshot.pursuitSnapshotId,
    documentSetFingerprint: snapshot.documentSetFingerprint,
    currentDocumentSetFingerprint: snapshot.currentDocumentSetFingerprint,
    snapshotStatus: snapshot.snapshotStatus,
    documents: snapshot.documents.map((doc) => [doc.id, doc.opportunityDocumentVersionId, doc.status, doc.checksumSha256]),
    understandingId: source?.understandingId ?? null,
    understandingStale: source?.isStale ?? null,
    agencyBaselineReviewCurrent: workspace.agencyBaselineReviewCurrent ?? false,
    sourceRequirements: source?.requirements.map((req) => [req.id, req.level, req.type, req.text,
      req.evidence.map((evidence) => evidence.opportunityDocumentVersionId),
      req.listingEvidence ? [req.listingEvidence.sourceRecordId,req.listingEvidence.payloadHash,
        req.listingEvidence.field,req.listingEvidence.excerpt] : null]) ?? [],
    requirements: workspace.requirements.map((req) => [req.id, req.status, req.effectiveStatus, req.responseNotes, req.evidence, req.responseEvidence]),
    sections: workspace.sections.map((section) => [section.id, section.title, section.instructions,
      section.content, section.requirementLinks, section.metadata]),
    confirmedOriginalForms: [...confirmed].sort(),
    portalUrl,
    dueAt: workspace.dueAt?.toISOString() ?? null,
  })).digest("hex");

  return {
    blockingIssues: issues,
    readyForHumanReview: issues.length === 0,
    // No automated submission integration exists. Submission is never inferred from package review.
    readyForExternalSubmission: false,
    reviewFingerprint,
    sourceChecks,
    submission: {
      portalUrl,
      dueAt: workspace.dueAt,
      method: submissionInstructions.length ? "Follow the cited authoritative source instructions" : "Unverified",
      instructions: submissionInstructions,
    },
  };
}
