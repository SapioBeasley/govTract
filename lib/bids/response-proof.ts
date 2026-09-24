import { createHash } from "node:crypto";

export type RequirementResponseEvidence =
  | { kind: "section"; sectionId: string; contentFingerprint: string;
      snapshotId: string; sourceFingerprint: string; understandingId: string }
  | { kind: "original_form"; sourceRequirementId: string;
      snapshotId: string; sourceFingerprint: string; understandingId: string };

export type RequirementResponseSelection =
  | { kind: "section"; sectionId: string }
  | { kind: "original_form" };

export type ResponseProofSource = {
  snapshotId: string | null;
  fingerprint: string | null;
  understandingId: string | null;
};
export type ResponseProofSection = {
  id: string;
  content: string | null;
  metadata: Record<string, unknown>;
};

/**
 * A source citation describes what the buyer wants; response evidence identifies
 * saved work produced by the bidder. These are deliberately distinct.
 */
function contentFingerprint(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function sectionReadiness(section: ResponseProofSection | undefined, source: ResponseProofSource): string | null {
  if (!section) return "Select a response section belonging to this bid.";
  if (!section.content?.trim()) return "Save a non-empty bid response in the selected section first.";
  if (/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\b(?:TODO|TBD)\s*[:\-]|\{\{[^}]+\}\}|<<[^>]+>>/i.test(section.content)) {
    return "Resolve the placeholder in the selected bid response before completing the requirement.";
  }
  if (section.metadata.sourceReviewRequired === true) {
    return "Finish the section's current-original source review and save it first.";
  }
  if (section.metadata.snapshotStale === true || section.metadata.understandingStale === true ||
      (section.metadata.pursuitSnapshotId && section.metadata.pursuitSnapshotId !== source.snapshotId) ||
      (section.metadata.documentSetFingerprint && section.metadata.documentSetFingerprint !== source.fingerprint) ||
      (section.metadata.understandingId && section.metadata.understandingId !== source.understandingId)) {
    return "Review and reconcile the response section against the current source package.";
  }
  return null;
}

export function buildBidResponseEvidence(
  selection: RequirementResponseSelection,
  sections: ResponseProofSection[],
  confirmedOriginalForms: string[],
  requirementType: string,
  sourceRequirementId: string,
  source: ResponseProofSource,
): RequirementResponseEvidence {
  if (!source.snapshotId || !source.fingerprint || !source.understandingId) {
    throw new Error("A current source package and understanding are required before confirming bid response coverage.");
  }
  if (selection.kind === "original_form") {
    if (requirementType !== "form") throw new Error("Only a form requirement can use an original form as response evidence.");
    if (!confirmedOriginalForms.includes(sourceRequirementId)) {
      throw new Error("Complete and confirm the required original form in Final review before marking this item Complete.");
    }
    return { kind: "original_form", sourceRequirementId, snapshotId: source.snapshotId,
      sourceFingerprint: source.fingerprint, understandingId: source.understandingId };
  }
  if (requirementType === "form") {
    throw new Error("Confirm the completed original form under Final review; bid text does not replace the form.");
  }
  const section = sections.find((item) => item.id === selection.sectionId);
  const reason = sectionReadiness(section, source);
  if (reason) throw new Error(reason);
  return { kind: "section", sectionId: section!.id,
    contentFingerprint: contentFingerprint(section!.content!.trim()), snapshotId: source.snapshotId,
    sourceFingerprint: source.fingerprint, understandingId: source.understandingId };
}

export function responseEvidenceIsCurrent(
  saved: RequirementResponseEvidence | null | undefined,
  sections: ResponseProofSection[],
  confirmedOriginalForms: string[],
  requirementType: string,
  sourceRequirementId: string,
  source: ResponseProofSource,
): boolean {
  if (!saved || !source.snapshotId || !source.fingerprint || !source.understandingId ||
      saved.snapshotId !== source.snapshotId ||
      saved.sourceFingerprint !== source.fingerprint ||
      saved.understandingId !== source.understandingId) return false;
  try {
    const next = buildBidResponseEvidence(
      saved.kind === "original_form" ? { kind: "original_form" } :
        { kind: "section", sectionId: saved.sectionId },
      sections, confirmedOriginalForms, requirementType, sourceRequirementId, source,
    );
    if (next.kind !== saved.kind || next.snapshotId !== saved.snapshotId ||
        next.sourceFingerprint !== saved.sourceFingerprint || next.understandingId !== saved.understandingId) return false;
    return next.kind === "section" && saved.kind === "section"
      ? next.sectionId === saved.sectionId && next.contentFingerprint === saved.contentFingerprint
      : next.kind === "original_form" && saved.kind === "original_form" &&
        next.sourceRequirementId === saved.sourceRequirementId;
  } catch {
    return false;
  }
}

export function savedSectionCanAddressRequirement(section: ResponseProofSection, source: ResponseProofSource) {
  return !sectionReadiness(section, source);
}
