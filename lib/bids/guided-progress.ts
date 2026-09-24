import type { BidWorkspaceRecord } from "./workspace";
import type { FinalReviewIssue } from "./final-review";

export type GuidanceStepId = "sources" | "reconcile" | "compliance" | "sections" | "assistance" | "originals" | "handoff";
export type GuidanceStatus =
  "Not started" | "Needs action" | "Blocked" | "In progress" | "Complete" | "Needs re-review";

export type GuidanceAction = {
  stepId: GuidanceStepId;
  label: string;
  reason: string;
  href: string;
  owner: "You" | "Source processing" | "External portal";
};
export type GuidanceStep = {
  id: GuidanceStepId;
  title: string;
  status: GuidanceStatus;
  description: string;
  href: string;
  count: number;
  optional?: boolean;
};
export type GuidedIssue = FinalReviewIssue & { href: string; owner: GuidanceAction["owner"] };
export type GuidanceIssueGroup = { stepId: GuidanceStepId; title: string; issues: GuidedIssue[] };

const titles: Record<GuidanceStepId, string> = {
  sources: "Current originals and understanding",
  reconcile: "Amendment and document reconciliation",
  compliance: "Compliance and mandatory requirements",
  sections: "Response sections and human review",
  assistance: "Manual AI drafting (optional)",
  originals: "Original signed forms and attachments",
  handoff: "Final human approval and portal handoff",
};
const anchors: Record<GuidanceStepId, string> = {
  sources: "#source-snapshot",
  reconcile: "#source-snapshot",
  compliance: "#compliance-requirements",
  sections: "#response-sections",
  assistance: "#response-sections",
  originals: "#final-review",
  handoff: "#final-review",
};

/** Pure projection of already persisted bid evidence; never writes progress or invokes a model. */
export function deriveBidGuidance(workspace: BidWorkspaceRecord) {
  const snapshot = workspace.sourceSnapshot;
  const source = workspace.sourceRequirements;
  const issues = workspace.finalReview.blockingIssues;
  const groups: GuidanceIssueGroup[] = (Object.keys(titles) as GuidanceStepId[])
    .filter((id) => id !== "assistance" && id !== "reconcile")
    .map((id) => ({ stepId: id, title: titles[id], issues: [] }));

  function groupFor(code: string): GuidanceStepId {
    if (code.startsWith("original_form_")) return "originals";
    if (code.startsWith("section_") || code === "response_sections_missing" ||
        code === "ai_vendor_facts_unverified") return "sections";
    if (code === "compliance_matrix_missing" || code === "requiredness_unverified" ||
        code === "mandatory_requirement_incomplete") return "compliance";
    if (code.startsWith("source_")) return "sources";
    return "handoff";
  }

  function linkTo(issue: FinalReviewIssue, id: GuidanceStepId): string {
    if (id === "sections" && issue.sectionId) return `#response-section-${issue.sectionId}`;
    if (id === "originals" && issue.requirementId) return `#original-form-${issue.requirementId}`;
    if (id === "compliance" && issue.requirementId) {
      const row = workspace.requirements.find((item) =>
        item.sourceRequirementKey === `${source?.understandingId}:${issue.requirementId}`);
      return row ? `#compliance-requirement-${row.id}` : anchors.compliance;
    }
    if (id === "sources" && issue.documentId) return `#source-document-${issue.documentId}`;
    return anchors[id];
  }
  for (const issue of issues) {
    const id = groupFor(issue.code);
    groups.find((group) => group.stepId === id)!.issues.push({
      ...issue, href: linkTo(issue, id),
      owner: issue.code.startsWith("source_document_") || issue.code === "source_snapshot_incomplete"
        ? "Source processing" : "You",
    });
  }
  const count = (id: GuidanceStepId) => groups.find((group) => group.stepId === id)?.issues.length ?? 0;
  const filesUnavailable = snapshot.documents.filter((document) => document.status !== "stored");
  const snapshotCurrent = Boolean(snapshot.pursuitSnapshotId &&
    snapshot.snapshotStatus === "complete" && !snapshot.stale &&
    snapshot.documentSetFingerprint &&
    snapshot.documentSetFingerprint === snapshot.currentDocumentSetFingerprint &&
    snapshot.storedDocumentCount === snapshot.totalDocumentCount &&
    snapshot.blockedDocumentCount === 0 && snapshot.failedDocumentCount === 0 &&
    filesUnavailable.length === 0);
  const understandingCurrent = Boolean(source && source.completenessStatus === "complete" &&
    !source.isStale && source.requirements.length > 0);
  const sourcesReady = snapshotCurrent && understandingCurrent && count("sources") === 0;

  const staleSections = workspace.sections.filter((section) =>
    section.metadata.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
    section.metadata.understandingId !== source?.understandingId ||
    section.metadata.documentSetFingerprint !== snapshot.documentSetFingerprint ||
    section.metadata.snapshotStale === true || section.metadata.understandingStale === true);
  const reconcileNeeded = staleSections.length > 0;
  const sourceReview = workspace.sections.filter((section) => section.metadata.sourceReviewRequired === true);
  const sectionIds = new Set([
    ...sourceReview.map((section) => section.id),
    ...groups.find((group) => group.stepId === "sections")!.issues
      .map((issue) => issue.sectionId).filter((id): id is string => Boolean(id)),
  ]);
  const sectionsMissing = workspace.sections.length === 0;
  const complianceMissing = workspace.requirements.length === 0;
  const originals = workspace.finalReview.sourceChecks.filter((check) => check.originalRequired);
  const formsMissing = originals.filter((check) => !check.originalConfirmed);
  const aiDrafts = workspace.sections.filter((section) => Boolean(section.metadata.aiDraftReview));
  const aiUnverified = workspace.sections.filter((section) => Boolean(section.metadata.aiDraftReview) &&
    !section.metadata.verifiedVendorFactsFingerprint);

  const steps: GuidanceStep[] = [
    {
      id: "sources", title: titles.sources,
      status: sourcesReady ? "Complete" : snapshot.stale || source?.isStale
        ? "Needs re-review" : !snapshotCurrent ? "Blocked" : "Needs action",
      description: sourcesReady
        ? `${snapshot.storedDocumentCount} original file(s) retained; current understanding verified.`
        : filesUnavailable.length
          ? `${filesUnavailable.length} original file(s) still need retrieval or source-access repair.`
          : !snapshotCurrent ? "Verify the current snapshot and amendments before preparing a response."
            : "Verify incomplete or missing understanding and its original-source evidence.",
      href: !snapshotCurrent ? anchors.sources : "#source-requirements",
      count: count("sources") || filesUnavailable.length,
    },
    {
      id: "reconcile", title: titles.reconcile,
      status: !reconcileNeeded ? "Complete" : !sourcesReady ? "Blocked" : "Needs action",
      description: !reconcileNeeded ? "No outline rebind is needed for the current snapshot."
        : `Review every retained original before reconciling ${staleSections.length} saved section(s); existing text is preserved.`,
      href: anchors.reconcile, count: staleSections.length,
    },
    {
      id: "compliance", title: titles.compliance,
      status: !sourcesReady || reconcileNeeded ? "Blocked" : complianceMissing ? "Not started"
        : count("compliance") ? "Needs action" : "Complete",
      description: complianceMissing ? "Generate the deterministic compliance checklist."
        : count("compliance") ? `${count("compliance")} mandatory/requiredness check(s) remain.`
          : "Current requirements have no outstanding compliance checks.",
      href: anchors.compliance, count: count("compliance"),
    },
    {
      id: "sections", title: titles.sections,
      status: !sourcesReady || reconcileNeeded ? "Blocked" : sectionsMissing ? "Not started"
        : sourceReview.length ? "Needs re-review" : sectionIds.size ? "Needs action" : "Complete",
      description: sectionsMissing ? "Prepare a source-derived outline without an AI call."
        : sourceReview.length ? `${sourceReview.length} preserved section(s) need original-source review and Save section.`
          : sectionIds.size ? `${sectionIds.size} response section(s) need editing or fact review.`
            : "Saved response sections have no outstanding section checks.",
      href: anchors.sections, count: sectionIds.size + (sectionsMissing ? 1 : 0),
    },
    {
      id: "assistance", title: titles.assistance, optional: true,
      status: !sourcesReady || reconcileNeeded ? "Blocked" : aiDrafts.length
        ? aiUnverified.length ? "Needs re-review" : "Complete" : "Not started",
      description: "Optional, explicitly triggered paid drafting. Review and save all generated claims yourself.",
      href: anchors.assistance, count: aiUnverified.length,
    },
    {
      id: "originals", title: titles.originals,
      status: !sourcesReady ? "Blocked" : count("originals") || formsMissing.length
        ? "Needs action" : "Complete",
      description: !originals.length ? "No original forms were identified; verify the source submission instructions."
        : `${originals.length - formsMissing.length}/${originals.length} original form(s) confirmed for external upload.`,
      href: anchors.originals, count: count("originals"),
    },
    {
      id: "handoff", title: titles.handoff,
      status: workspace.finalReviewApprovalCurrent && workspace.finalReview.readyForHumanReview
        ? "Complete" : workspace.reviewState === "approved" ? "Needs re-review"
          : issues.length ? "Blocked" : "Needs action",
      description: workspace.finalReviewApprovalCurrent && workspace.finalReview.readyForHumanReview
        ? "Human approval is current. Submit separately at the authoritative external portal and retain its receipt."
        : issues.length ? `${issues.length} final-review check(s) remain; Draft with AI is not submission readiness.`
          : "Approve the exact saved package yourself before external portal handoff.",
      href: anchors.handoff, count: issues.length,
    },
  ];

  const action = (stepId: GuidanceStepId, label: string, reason: string, href: string,
    owner: GuidanceAction["owner"] = "You"): GuidanceAction =>
    ({ stepId, label, reason, href, owner });

  let nextAction: GuidanceAction;
  if (!snapshotCurrent) {
    const file = filesUnavailable[0];
    nextAction = file
      ? action("sources", file.status === "pending" ? "Retrieve source files" : "Repair unavailable original",
        `${file.filename} is ${file.status}${file.failureCode ? ` (${file.failureCode})` : ""}; retrieve or repair the original before proceeding.`,
        "#source-snapshot", "Source processing")
      : action("sources", "Review current source snapshot",
        snapshot.stale ? "An authoritative amendment changed; refresh and inspect the original package."
          : "The complete current source package has not been retained.", anchors.sources, "Source processing");
  } else if (!understandingCurrent || count("sources")) {
    nextAction = action("sources", "Verify current understanding",
      source?.incompleteReasons.length ? source.incompleteReasons.join("; ")
        : count("sources") ? groups.find((group) => group.stepId === "sources")!.issues[0]!.message
          : "A complete current understanding with pinned source evidence is required.",
      "#source-requirements");
  } else if (reconcileNeeded) {
    nextAction = action("reconcile", "Review originals, then reconcile",
      `Inspect and confirm each of the ${snapshot.documents.length} original documents in Source snapshot before using Reconcile. Existing response text must be re-reviewed.`,
      anchors.reconcile);
  } else if (sourceReview.length) {
    const section = sourceReview[0]!;
    nextAction = action("sections", `Review and save ${section.title}`,
      `Compare preserved ${section.title} text and instructions with current originals, check its review box, then Save section. Other sections remain independently actionable.`,
      `#response-section-${section.id}`);
  } else if (complianceMissing || count("compliance")) {
    const first = groups.find((group) => group.stepId === "compliance")!.issues[0];
    nextAction = action("compliance", complianceMissing ? "Generate compliance matrix" : "Resolve next compliance check",
      first?.message ?? "Generate the deterministic compliance matrix from current source requirements.",
      first?.href ?? anchors.compliance);
  } else if (sectionsMissing || sectionIds.size) {
    const section = workspace.sections.find((item) => sectionIds.has(item.id));
    nextAction = action("sections", sectionsMissing ? "Generate response outline" : "Review next response section",
      sectionsMissing ? "Create and review the source-derived outline; no AI request is required."
        : `Review, edit and Save section: ${section?.title ?? "response"}.`,
      section ? `#response-section-${section.id}` : anchors.sections);
  } else if (count("originals") || formsMissing.length) {
    const first = groups.find((group) => group.stepId === "originals")!.issues[0];
    nextAction = action("originals", "Confirm original forms and attachments",
      first?.message ?? "Verify signatures and external upload for the original source forms.",
      first?.href ?? `#original-form-${formsMissing[0]!.requirementId}`);
  } else if (issues.length) {
    const first = groups.find((group) => group.stepId === "handoff")!.issues[0] ??
      groups.find((group) => group.issues.length)!.issues[0]!;
    nextAction = action("handoff", "Resolve final submission checks", first.message, first.href);
  } else if (!workspace.finalReviewApprovalCurrent) {
    nextAction = action("handoff", "Approve current package",
      workspace.reviewState === "approved"
        ? "Previous approval is stale. Review and explicitly approve the exact current package again."
        : "Confirm the saved response, original forms, signatures and source instructions, then record human approval.",
      anchors.handoff);
  } else {
    nextAction = action("handoff", "Open external submission portal",
      "Human approval is current. govTract does not submit bids; follow the authoritative portal and retain its receipt.",
      anchors.handoff, "External portal");
  }

  return {
    steps: steps.filter((step) => step.id !== "reconcile" || reconcileNeeded),
    nextAction,
    groupedIssues: groups.filter((group) => group.issues.length > 0),
  };
}
