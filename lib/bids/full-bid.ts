import type { BidWorkspaceSection, BidWorkspaceSourceSnapshot } from "@/lib/bids/workspace";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

export const FULL_BID_WORKFLOW = "full_bid_v1";

export type SupportingDocumentItem = {
  requirementId: string;
  text: string;
  kind: string;
  mandatory: boolean;
  conditional: boolean;
  sourceVersionIds: string[];
};

const SUPPORT_TYPES = new Set([
  "form", "pricing", "certification", "bonding", "insurance", "insurance_bonding",
  "license", "attachment", "reference", "product_literature",
]);

const SUPPORT_TEXT = /\b(?:attach|attachment|include|submit|provide|complete|sign|upload)\b[\s\S]{0,120}\b(?:form|sheet|certificate|certification|license|insurance|bond|w-?9|reference|literature|brochure|specification|drawing|affidavit|schedule)\b/i;

export function isFullBidSection(section: Pick<BidWorkspaceSection, "title" | "metadata">) {
  return section.metadata.workflow === FULL_BID_WORKFLOW || section.title === "Full bid draft";
}

export function findFullBidSection(sections: BidWorkspaceSection[]) {
  return sections.find(isFullBidSection) ?? null;
}

export function hasNeedsInput(content: string | null | undefined) {
  return /\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]|\b(?:TODO|TBD)\s*[:\-]|\{\{[^}]+\}\}|<<[^>]+>>/i.test(content ?? "");
}

export function deriveSupportingDocumentItems(requirements: PersistedSolicitationRequirement[]): SupportingDocumentItem[] {
  return requirements.flatMap((requirement) => {
    const relevant = SUPPORT_TYPES.has(requirement.type) || SUPPORT_TEXT.test(requirement.text);
    if (!relevant) return [];
    const conditional = requirement.level === "conditional";
    return [{
      requirementId: requirement.id,
      text: requirement.text,
      kind: requirement.type,
      mandatory: requirement.level === "required",
      conditional,
      sourceVersionIds: [...new Set(requirement.evidence.map((evidence) => evidence.opportunityDocumentVersionId))],
    }];
  });
}

export function generationBlockers(input: {
  snapshot: BidWorkspaceSourceSnapshot;
  requirements: { isStale: boolean; completenessStatus: string; requirements: PersistedSolicitationRequirement[] } | null;
}) {
  const blockers: string[] = [];
  if (input.snapshot.snapshotStatus !== "complete" ||
      input.snapshot.storedDocumentCount !== input.snapshot.totalDocumentCount ||
      input.snapshot.documents.some((document) => document.status !== "stored")) {
    blockers.push("The complete solicitation package is not readable yet. Retrieve the missing source files first.");
  }
  if (input.snapshot.stale ||
      !input.snapshot.documentSetFingerprint ||
      input.snapshot.documentSetFingerprint !== input.snapshot.currentDocumentSetFingerprint) {
    blockers.push("The solicitation changed. Refresh the retained source package before generating the bid.");
  }
  if (!input.requirements || input.requirements.isStale ||
      input.requirements.completenessStatus !== "complete" || !input.requirements.requirements.length) {
    blockers.push("The current solicitation requirements are not ready. Refresh solicitation understanding before generating the bid.");
  }
  return [...new Set(blockers)];
}
