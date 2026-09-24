import { isComplianceEvidence } from "./compliance";
import type { BidWorkspaceRequirement } from "./workspace";

export type ComplianceGuidanceContext = {
  workspaceId: string;
  sourceReady: boolean;
  snapshotCurrent: boolean;
  understandingCurrent: boolean;
  currentSnapshotId: string | null;
  currentUnderstandingId: string | null;
  sections: Array<{ id: string; title: string; ready: boolean }>;
  confirmedOriginalForms: string[];
  sourceReviewAllowed?: boolean;
  documents?: Array<{ id: string; opportunityDocumentVersionId: string; filename: string;
    status: string; checksumSha256: string | null }>;
};
export type ComplianceGuidance = {
  kind: "blocked" | "actionable" | "addressed";
  canComplete: boolean;
  blocker?: "source" | "response";
  explanation: string;
  nextAction: string;
  link: { href: string; label: string };
};

/** Presentation only: server-side evidence and saved-response checks remain authoritative. */
export function explainComplianceRequirement(
  requirement: BidWorkspaceRequirement,
  context: ComplianceGuidanceContext,
): ComplianceGuidance {
  const evidence = isComplianceEvidence(requirement.evidence) ? requirement.evidence : null;
  const evidenceHref = `/bids/${context.workspaceId}/evidence/${requirement.id}`;
  const blocked = (explanation: string, nextAction: string, href: string, label: string): ComplianceGuidance => ({
    kind: "blocked", canComplete: false, blocker: "source", explanation, nextAction, link: { href, label },
  });
  if (!context.snapshotCurrent) {
    return blocked(
      "Complete is unavailable because the current original solicitation package is missing, incomplete, or changed.",
      "Retrieve or reconcile current originals and amendments in Source snapshot; then return to this requirement.",
      "#source-snapshot", "Review current originals",
    );
  }
  if (!context.understandingCurrent) {
    return blocked(
      "Complete is unavailable because the current solicitation understanding is incomplete or needs source review.",
      "Check which source finding is unverified in Source requirements before continuing. An AI refresh is not automatic.",
      "#source-requirements", "Review current understanding",
    );
  }
  if (!evidence) {
    return blocked(
      "Complete is unavailable because this response has no verifiable source reference.",
      "Inspect the original solicitation and create or repair the source-derived compliance requirement.",
      "#source-requirements", "Review source requirements",
    );
  }
  if (evidence.pursuitSnapshotId !== context.currentSnapshotId ||
      evidence.understandingId !== context.currentUnderstandingId) {
    return blocked(
      requirement.status === "complete"
        ? "This was previously marked Complete, but the source or understanding changed. The earlier response still exists and needs re-review."
        : "Complete is unavailable because this row is pinned to an earlier source package or understanding.",
      "Review the current originals and reconcile the bid. Existing response notes and old evidence must not be silently overwritten.",
      "#source-snapshot", "Review changed originals",
    );
  }
  if (evidence.requirementLevel === "unknown" ||
      evidence.issues.includes("requirement_requiredness_unknown")) {
    return blocked(
      "Complete is unavailable because the original solicitation has not established whether this item is mandatory.",
      "View the original source (read-only). Viewing it does not resolve requiredness. An audited reviewer determination linked to the current original excerpt is required; no in-product resolution action is available yet.",
      evidenceHref, "View original evidence (read-only)",
    );
  }
  if (evidence.issues.includes("requirement_evidence_missing") ||
      (!evidence.references.length && !evidence.listingEvidence)) {
    return blocked(
      "Complete is unavailable because the solicitation evidence for this requirement is missing.",
      "View pinned originals (read-only). Viewing a document does not resolve missing evidence. Retrieve missing originals in Source snapshot; if no original excerpt exists, this row stays blocked until a verifiable source excerpt is recovered.",
      evidenceHref, "View source evidence (read-only)",
    );
  }
  // The server can clear these transient source-retrieval warnings when the exact pinned file is restored.
  const unresolved = evidence.issues.filter((issue) =>
    issue !== "snapshot_incomplete" && issue !== "evidence_document_unavailable");
  if (unresolved.length || !requirement.canMarkComplete) {
    return blocked(
      requirement.status === "complete"
        ? "This was previously marked Complete, but its original source evidence is no longer verifiable."
        : "Complete is unavailable because the pinned source evidence is not currently verifiable.",
      unresolved.length
        ? `Inspect the original citation and resolve its source warning: ${unresolved.map((issue) => issue.replaceAll("_", " ")).join("; ")}.`
        : "Inspect the original document, version and evidence. Review current sources before retrying.",
      evidenceHref, "View source evidence (read-only)",
    );
  }
  if (requirement.requirementType === "form" &&
      !context.confirmedOriginalForms.includes(evidence.sourceRequirementId)) {
    return { ...blocked(
      "Complete is unavailable because the required original form has not yet been confirmed as completed and included in your bid.",
      "Complete the buyer's original form and confirm it under Final review. A drafted paragraph cannot replace the original.",
      "#final-review", "Confirm original form in final review",
    ), blocker: "response" };
  }
  if (requirement.requirementType !== "form" && !context.sections.some((section) => section.ready)) {
    return { ...blocked(
      "Complete is blocked because this bid has no saved, current bid response section ready to address the requirement.",
      "Draft and save the matching response section first. You can track this requirement as Working on it in the meantime.",
      "#response-sections", "Draft and save a bid response",
    ), blocker: "response" };
  }
  if (requirement.status === "complete" && requirement.effectiveStatus !== "complete") {
    return {
      kind: "actionable", canComplete: true,
      explanation: "This requirement was previously marked Complete, but its saved bid response or original-form proof is no longer current. Review the actual response and confirm it again.",
      nextAction: "Choose the current saved bid section or confirmed original form, review it, then save Complete again.",
      link: { href: "#response-sections", label: "Review saved bid response" },
    };
  }
  if (requirement.effectiveStatus === "complete") {
    return {
      kind: "addressed", canComplete: true,
      explanation: "You marked this requirement addressed in your bid. This does not certify vendor facts, original forms, signatures, or submission.",
      nextAction: "Check your saved response and final-review checklist before external submission.",
      link: { href: "#final-review", label: "View final review" },
    };
  }
  return {
    kind: "actionable", canComplete: context.sourceReady && requirement.canMarkComplete,
    explanation: "The buyer's requirement has verifiable source evidence. Complete means you have addressed it in your bid, not just read it.",
    nextAction: "Review the response section or required original form, document where your bid addresses this item in response notes, select Complete, then Save requirement.",
    link: { href: "#response-sections", label: "Go to response sections" },
  };
}
