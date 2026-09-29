import { createHash } from "node:crypto";

import type { SolicitationRequirementSet } from "@/lib/procurement/requirements/persistence";

export type SupportingSourceDocument = {
  opportunityDocumentVersionId: string;
  filename: string;
};

export type SupportingItem = {
  id: string;
  requirementKey: string;
  label: string;
  kind: string;
  required: boolean;
  conditional: boolean;
  originalForm: boolean;
  action: "external_attachment";
  sourceVersionIds: string[];
  sourceFiles: string[];
  listingSource: boolean;
};

export type SupportingChecklistState = {
  fingerprint: string;
  readyItemIds: string[];
  applicableItemIds: string[];
};

const attachmentVerb = /\b(?:attach|attached|attachment|include|submit|upload|provide|return|furnish|enclose)\b/i;
const attachmentNoun = /\b(?:w[- ]?9|form|affidavit|worksheet|sheet|schedule|certificate|proof|evidence|copy|license|licence|certification|bond|reference(?:s)?|resume|résumé|past performance|product literature|manufacturer literature|specification(?:s)?|data sheet|brochure|catalog|manual|warranty documentation)\b/i;
const productMaterial = /\b(?:product|manufacturer|equipment)\b.*\b(?:literature|specification(?:s)?|data sheet|brochure|catalog|manual)\b|\b(?:literature|specification(?:s)?|data sheet|brochure|catalog|manual)\b.*\b(?:product|manufacturer|equipment)\b/i;
const referenceMaterial = /\b(?:references?|past performance|resume|résumé)\b/i;
const proofMaterial = /\b(?:certificate|proof|evidence|copy)\b/i;
const formMaterial = /\b(?:w[- ]?9|form|affidavit|worksheet|sheet|schedule|template)\b/i;

function explicitAttachment(details: Record<string, unknown> | null | undefined) {
  if (!details) return false;
  return details.requiredAttachment === true || details.attachmentRequired === true ||
    details.templateRequired === true || details.requiredOriginalForm === true ||
    typeof details.requiredFileName === "string" || typeof details.formFilename === "string" ||
    typeof details.templateFilename === "string";
}

function supportsChecklist(requirement: SolicitationRequirementSet["requirements"][number]) {
  const text = requirement.text;
  const details = requirement.details;
  if (explicitAttachment(details)) return true;
  if (requirement.type === "form") return true;
  if (requirement.type === "pricing") {
    return formMaterial.test(text) || (attachmentVerb.test(text) && attachmentNoun.test(text));
  }
  if (requirement.type === "insurance" || requirement.type === "bonding" ||
      requirement.type === "insurance_bonding") {
    return proofMaterial.test(text) || (attachmentVerb.test(text) && attachmentNoun.test(text));
  }
  if (requirement.type === "license" || requirement.type === "certification") {
    return proofMaterial.test(text) || attachmentVerb.test(text);
  }
  if (requirement.type === "qualification") {
    return referenceMaterial.test(text) && attachmentVerb.test(text);
  }
  return productMaterial.test(text) ||
    (attachmentVerb.test(text) && attachmentNoun.test(text));
}

function originalFormRequired(requirement: SolicitationRequirementSet["requirements"][number]) {
  const details = requirement.details ?? {};
  if (details.requiredOriginalForm === true || details.templateRequired === true) return true;
  if (requirement.type === "form") return true;
  return /\b(?:original|provided|buyer[- ]provided|agency[- ]provided)\s+(?:form|template|worksheet|sheet|schedule)\b/i.test(requirement.text) ||
    /\b(?:complete|fill out|return)\b.*\b(?:provided )?(?:form|worksheet|sheet|template)\b/i.test(requirement.text);
}

export function deriveSupportingItems(input: {
  requirements: SolicitationRequirementSet | null;
  documents: SupportingSourceDocument[];
}): SupportingItem[] {
  if (!input.requirements) return [];
  const filenameByVersion = new Map(input.documents.map((document) => [
    document.opportunityDocumentVersionId, document.filename,
  ]));
  return input.requirements.requirements.flatMap((requirement) => {
    if (!supportsChecklist(requirement)) return [];
    const sourceVersionIds = [...new Set(requirement.evidence.map((evidence) =>
      evidence.opportunityDocumentVersionId,
    ))].sort();
    const sourceFiles = [...new Set(sourceVersionIds.flatMap((versionId) => {
      const filename = filenameByVersion.get(versionId);
      return filename ? [filename] : [];
    }))].sort();
    const required = requirement.level === "required";
    return [{
      id: requirement.id,
      requirementKey: requirement.requirementKey,
      label: requirement.text.trim(),
      kind: requirement.type,
      required,
      conditional: !required,
      originalForm: originalFormRequired(requirement),
      action: "external_attachment" as const,
      sourceVersionIds,
      sourceFiles,
      listingSource: Boolean(requirement.listingEvidence),
    }];
  });
}

export function supportingChecklistFingerprint(input: {
  requirements: SolicitationRequirementSet | null;
  documentSetFingerprint: string | null;
}) {
  const items = deriveSupportingItems({ requirements: input.requirements, documents: [] });
  return createHash("sha256").update(JSON.stringify({
    documentSetFingerprint: input.documentSetFingerprint,
    understandingId: input.requirements?.understandingId ?? null,
    items: items.map((item) => [
      item.id, item.requirementKey, item.label, item.kind, item.required, item.originalForm,
      item.sourceVersionIds, item.listingSource,
    ]),
  })).digest("hex");
}

export function evaluateSupportingChecklist(
  items: SupportingItem[],
  state: SupportingChecklistState | null | undefined,
  currentFingerprint: string,
) {
  const stateCurrent = state?.fingerprint === currentFingerprint;
  const validIds = new Set(items.map((item) => item.id));
  const conditionalIds = new Set(items.filter((item) => item.conditional).map((item) => item.id));
  const readyItemIds = stateCurrent
    ? [...new Set(state?.readyItemIds ?? [])].filter((id) => validIds.has(id))
    : [];
  const applicableItemIds = stateCurrent
    ? [...new Set(state?.applicableItemIds ?? [])].filter((id) => conditionalIds.has(id))
    : [];
  const ready = new Set(readyItemIds);
  const applicable = new Set(applicableItemIds);
  const blockingItemIds = items.filter((item) =>
    (item.required || (item.conditional && applicable.has(item.id))) && !ready.has(item.id),
  ).map((item) => item.id);
  return {
    stateCurrent,
    readyForPackage: blockingItemIds.length === 0,
    blockingItemIds,
    readyItemIds,
    applicableItemIds,
  };
}
