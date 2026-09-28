export type BidBuilderSaveState = "unsaved" | "saving" | "saved" | "error";

export function deriveSaveState(input: { changed: boolean; pending: boolean; failed?: boolean }): BidBuilderSaveState {
  if (input.pending) return "saving";
  if (input.failed) return "error";
  if (input.changed) return "unsaved";
  return "saved";
}

export function saveStateLabel(state: BidBuilderSaveState) {
  return state === "saving" ? "Saving…" :
    state === "unsaved" ? "Unsaved changes" :
    state === "error" ? "Save failed" : "Saved draft";
}

export type BidBuilderProgressInput = {
  activeSections: Array<{ id: string; content: string | null }>;
  activeRequirements: Array<{ id: string; effectiveStatus: string; sourceResolutionStatus?: string | null; sectionId?: string | null }>;
  baselineExists: boolean;
  baselineReviewed: boolean;
  sourceReady: boolean;
  finalReviewBlockers: number;
};

export function deriveBidBuilderProgress(input: BidBuilderProgressInput) {
  const savedSections = input.activeSections.filter((section) => Boolean(section.content?.trim())).length;
  const addressedRequirements = input.activeRequirements.filter((requirement) => requirement.effectiveStatus === "complete").length;
  const unresolvedSourceChecks = input.activeRequirements.filter((requirement) =>
    requirement.sourceResolutionStatus === "unresolved" || requirement.sourceResolutionStatus === "needs_review").length;

  let nextAction = { label: "Ready for final review", href: "#final-review" };
  if (!input.sourceReady) nextAction = { label: "Check current source documents", href: "#source-documents-and-technical-details" };
  else {
    const empty = input.activeSections.find((section) => !section.content?.trim());
    const source = input.activeRequirements.find((requirement) =>
      requirement.sourceResolutionStatus === "unresolved" || requirement.sourceResolutionStatus === "needs_review");
    const unaddressed = input.activeRequirements.find((requirement) => requirement.effectiveStatus !== "complete");
    if (empty) nextAction = { label: "Write and save the next response", href: `#response-section-${empty.id}` };
    else if (source) nextAction = { label: "Check the original buyer instruction", href: `#compliance-requirement-${source.id}` };
    else if (unaddressed) nextAction = { label: "Review requirement coverage", href: `#compliance-requirement-${unaddressed.id}` };
    else if (input.baselineExists && !input.baselineReviewed) nextAction = { label: "Review standard agency terms", href: "#standard-agency-terms" };
    else if (input.finalReviewBlockers > 0) nextAction = { label: "Resolve final-review blockers", href: "#final-review" };
  }

  return { savedSections, totalSections: input.activeSections.length, addressedRequirements,
    totalRequirements: input.activeRequirements.length, unresolvedSourceChecks, nextAction };
}
