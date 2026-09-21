import { createHash } from "node:crypto";

import type { CompanyProfile } from "@/lib/company/profile";
import type { BidWorkspaceSection, BidWorkspaceSourceSnapshot } from "@/lib/bids/workspace";
import type { SolicitationRequirementSet, PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

export const BID_DRAFT_PROMPT_VERSION = "2";
const MAX_SOURCE_CHARS = 48_000;

export type DraftSourceVersion = {
  versionId: string;
  snapshotDocumentId: string;
  filename: string;
  checksumSha256: string;
};

export type BidDraftPacket = {
  sectionTitle: string;
  sectionInstructions: string;
  snapshotId: string;
  understandingId: string;
  documentSetFingerprint: string;
  sourceDocumentVersions: DraftSourceVersion[];
  requirementKeys: string[];
  sourceEvidence: string;
  companyContext: string;
  requiredQuestions: string[];
  inputFingerprint: string;
};

export type BidDraftPreparation =
  | { state: "blocked"; reasons: string[] }
  | { state: "ready"; packet: BidDraftPacket };

export type ModelDraftOutput = {
  content: string;
  requirementKeys: string[];
  missingFacts: string[];
};

function questionFor(requirement: PersistedSolicitationRequirement): string | null {
  const text = requirement.text.toLowerCase();
  if (requirement.type === "pricing" || /\b(price|pricing|rate|cost|budget)\b/.test(text)) {
    return "Confirm final pricing against the authoritative pricing worksheet and approvals";
  }
  if (requirement.type === "certification" || /\bcertif(?:ication|ied|y)\b/.test(text)) {
    return "Provide and verify applicable company certifications";
  }
  if (requirement.type === "license" || /\blicen[cs]e\b/.test(text)) {
    return "Provide and verify applicable licenses";
  }
  if (/\b(past performance|references?|prior project|previous contract|experience)\b/.test(text)) {
    return "Verify project history, customers, and past-performance evidence";
  }
  if (/\b(staff|personnel|crew|equipment|vehicle|capacity)\b/.test(text)) {
    return "Verify available staffing, equipment, and operational capacity";
  }
  if (/\b(insurance|bond)\b/.test(text)) {
    return "Verify insurance and bonding documentation and limits";
  }
  if (requirement.type === "form" || /\b(form|affidavit|signature|signed)\b/.test(text)) {
    return "Complete the original required source form and verify signatures";
  }
  return null;
}

/**
 * Unlinked rules are not implicitly relevant to every section merely because they
 * concern pricing, forms, qualifications or submission. Only explicit applicability
 * metadata can add a separately evidenced, cross-section rule.
 */
function explicitlyGovernsSection(requirement: PersistedSolicitationRequirement, title: string) {
  const details = requirement.details;
  if (details.appliesToAllResponseSections === true) return true;
  const sections = details.appliesToResponseSections;
  return Array.isArray(sections) && sections.some((value) =>
    typeof value === "string" && value.trim().toLocaleLowerCase("en-US") === title.trim().toLocaleLowerCase("en-US"));
}

function uniqueSectionInstructions(instructions: string | null, linkedRequirements: PersistedSolicitationRequirement[]) {
  const repeatedRequirementText = new Set(linkedRequirements.map((requirement) => requirement.text.trim()));
  const emitted = new Set<string>();
  return (instructions ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    if (!line || repeatedRequirementText.has(line) || emitted.has(line)) return false;
    emitted.add(line);
    return true;
  }).join("\n");
}

/**
 * Called only from a user-triggered draft action. Refuses to send stale, incomplete or
 * unanchored procurement material to an AI model, even when the page can display it.
 * No provider calls, I/O or source retrieval are performed here.
 */
export function prepareBidDraftInput(input: {
  snapshot: BidWorkspaceSourceSnapshot;
  section: BidWorkspaceSection;
  requirements: SolicitationRequirementSet | null;
  company: Pick<CompanyProfile, "name" | "capabilities"> | null;
}): BidDraftPreparation {
  const { snapshot, section, requirements } = input;
  const reasons: string[] = [];
  if (snapshot.snapshotStatus !== "complete" || !snapshot.pursuitSnapshotId ||
    snapshot.totalDocumentCount === 0 || snapshot.storedDocumentCount !== snapshot.totalDocumentCount ||
    snapshot.blockedDocumentCount || snapshot.failedDocumentCount ||
    snapshot.documents.length !== snapshot.totalDocumentCount ||
    snapshot.documents.some((document) => document.status !== "stored" || !document.checksumSha256)) {
    reasons.push("The source document snapshot is incomplete or missing verified original files.");
  }
  if (snapshot.stale || !snapshot.documentSetFingerprint ||
    snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint) {
    reasons.push("The source document set has changed. Review the latest authoritative amendments before drafting.");
  }
  if (!requirements || requirements.isStale || requirements.completenessStatus !== "complete") {
    reasons.push("Current, complete structured solicitation understanding is required for drafting.");
  }
  if (requirements && section.metadata.understandingId !== requirements.understandingId) {
    reasons.push("The bid outline is linked to an older solicitation understanding; review and refresh the outline.");
  }
  if (!snapshot.pursuitSnapshotId || section.metadata.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
    section.metadata.documentSetFingerprint !== snapshot.documentSetFingerprint) {
    reasons.push("The bid outline is not linked to the current preserved document snapshot.");
  }

  const rawKeys = section.requirementLinks.sourceRequirementKeys;
  const keys = Array.isArray(rawKeys) && rawKeys.every((value) => typeof value === "string") ?
    [...new Set(rawKeys as string[])] : [];
  if (keys.length === 0) reasons.push("This bid section has no linked, evidence-backed requirements.");

  const requirementMap = new Map(requirements?.requirements.map((requirement) => [requirement.requirementKey, requirement]));
  const linked = keys.map((key) => requirementMap.get(key));
  if (linked.some((requirement) => !requirement)) {
    reasons.push("One or more linked solicitation requirements no longer exist in the current understanding.");
  }
  const snapshotDocuments = new Map(snapshot.documents.map((document) => [document.opportunityDocumentVersionId, document]));
  const selectedLinked = linked.filter((requirement): requirement is PersistedSolicitationRequirement => Boolean(requirement));
  const governing = requirements?.requirements.filter((requirement) =>
    !keys.includes(requirement.requirementKey) &&
    explicitlyGovernsSection(requirement, section.title)) ?? [];
  const selected = [...selectedLinked, ...governing];

  // Version metadata is recorded once per referenced source file. A requirement
  // refers to a shared, verbatim passage by ID instead of resending document IDs,
  // checksums and extracted content for every duplicate understanding finding.
  const selectedDocumentVersions = new Set<string>();
  const passageIds = new Map<string, string>();
  const passages: Array<{
    id: string; documentVersionId: string; segmentId: string | null;
    locator: Record<string, unknown>; excerpt: string;
  }> = [];
  const selectedRequirements: Array<{
    key: string; type: string; text: string; level: string;
    evidenceIds: string[]; relevance: "section" | "cross_section_rule";
  }> = [];
  for (const requirement of selected) {
    if (!requirement.evidence.length) {
      reasons.push(`Solicitation requirement ${requirement.requirementKey} lacks source-document evidence.`);
      continue;
    }
    const evidenceIds = new Set<string>();
    for (const evidence of requirement.evidence) {
      const document = snapshotDocuments.get(evidence.opportunityDocumentVersionId);
      if (!document || document.status !== "stored" || !document.checksumSha256 ||
        !evidence.excerpt?.trim()) {
        reasons.push(`Solicitation requirement ${requirement.requirementKey} lacks a readable source excerpt pinned to the bid snapshot.`);
        continue;
      }
      selectedDocumentVersions.add(evidence.opportunityDocumentVersionId);
      // Include the locator in the dedupe identity: one segment may identify
      // different cells/pages or quoted passages with distinct locators.
      const passageKey = JSON.stringify([
        evidence.opportunityDocumentVersionId,
        evidence.documentExtractionSegmentId,
        evidence.locator,
        evidence.excerpt,
      ]);
      let passageId = passageIds.get(passageKey);
      if (!passageId) {
        passageId = `p${passages.length + 1}`;
        passageIds.set(passageKey, passageId);
        passages.push({
          id: passageId,
          documentVersionId: evidence.opportunityDocumentVersionId,
          segmentId: evidence.documentExtractionSegmentId,
          locator: evidence.locator,
          excerpt: evidence.excerpt,
        });
      }
      evidenceIds.add(passageId);
    }
    if (evidenceIds.size) selectedRequirements.push({
      key: requirement.requirementKey,
      type: requirement.type,
      text: requirement.text,
      level: requirement.level,
      evidenceIds: [...evidenceIds],
      relevance: keys.includes(requirement.requirementKey) ? "section" : "cross_section_rule",
    });
  }
  const sourceDocuments = [...snapshot.documents]
    .sort((a, b) => a.opportunityDocumentVersionId.localeCompare(b.opportunityDocumentVersionId))
    .map((document): DraftSourceVersion => ({
      versionId: document.opportunityDocumentVersionId,
      snapshotDocumentId: document.id,
      filename: document.filename,
      checksumSha256: document.checksumSha256 ?? "",
    }));
  const sourceEvidence = JSON.stringify({
    documents: sourceDocuments.filter((document) => selectedDocumentVersions.has(document.versionId)),
    passages,
    requirements: selectedRequirements,
    caveat: "Only the cited excerpts from the listed snapshot documents are supplied, not the full solicitation. Independently inspect the original documents and mandatory forms.",
  });
  if (sourceEvidence.length > MAX_SOURCE_CHARS) {
    reasons.push("Section-relevant verified source evidence exceeds the AI input limit. Review and split the response section before drafting; no source requirements were silently removed.");
  }
  if (reasons.length) return { state: "blocked", reasons: [...new Set(reasons)] };

  const companyContext = input.company
    ? JSON.stringify({
      verification: "USER_ENTERED_UNVERIFIED",
      name: input.company.name,
      capabilities: input.company.capabilities,
      instruction: "These user-entered values are NOT evidence of credentials, prior customers, staffing, insurance, rates or performance. Do not present them as verified.",
    })
    : "No company facts are available. Use explicit placeholders for all company-specific statements.";
  const requiredQuestions = [...new Set([
    ...(input.company ? [] : ["Provide and verify the company legal name and authorized bidder"]),
    ...selected.map(questionFor).filter((question): question is string => question !== null),
  ])];
  const packetWithoutFingerprint = {
    sectionTitle: section.title,
    sectionInstructions: uniqueSectionInstructions(section.instructions, selectedLinked),
    snapshotId: snapshot.pursuitSnapshotId!,
    understandingId: requirements!.understandingId,
    documentSetFingerprint: snapshot.documentSetFingerprint!,
    sourceDocumentVersions: sourceDocuments,
    requirementKeys: keys,
    sourceEvidence,
    companyContext,
    requiredQuestions,
  };
  return {
    state: "ready",
    packet: {
      ...packetWithoutFingerprint,
      inputFingerprint: createHash("sha256").update(JSON.stringify({
        promptVersion: BID_DRAFT_PROMPT_VERSION,
        ...packetWithoutFingerprint,
      })).digest("hex"),
    },
  };
}

/** Sanitize structured provider output against the exact section requirements; no invented citations. */
export function finalizeBidDraft(packet: BidDraftPacket, value: ModelDraftOutput) {
  if (!value || typeof value.content !== "string" || !value.content.trim() ||
    value.content.length > 60_000 || !Array.isArray(value.requirementKeys) ||
    !value.requirementKeys.every((key) => typeof key === "string") ||
    !Array.isArray(value.missingFacts) || !value.missingFacts.every((question) =>
      typeof question === "string" && question.length <= 300)) {
    throw new Error("The model returned an invalid bid draft structure.");
  }
  if (value.requirementKeys.some((key) => !packet.requirementKeys.includes(key))) {
    throw new Error("The model cited an unsupported requirement.");
  }
  const questions = [...new Set([...packet.requiredQuestions, ...value.missingFacts].map((question) =>
    question.trim().replace(/[\r\n\[\]]/g, " ").trim()).filter(Boolean))];
  return {
    content: value.content.trim() + (questions.length
      ? "\n\nOpen factual questions — verify before submission:\n" +
        questions.map((question) => "- [NEEDS INPUT: " + question + "]").join("\n")
      : ""),
    requirementKeys: [...new Set(value.requirementKeys)],
    missingFacts: questions,
  };
}
