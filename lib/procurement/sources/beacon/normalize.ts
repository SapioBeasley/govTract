import {
  hashPayload,
  type PersistableClassification,
  type PersistableDocument,
  type PersistableOpportunityRecord,
  type PersistableSourceRecord,
} from "@/lib/procurement/ingestion/persistence";
import type {
  ProcurementSourceAdapter,
  ProcurementSourceContext,
} from "@/lib/procurement/sources/adapter";
import { enrichBeaconDocumentMetadata } from "@/lib/procurement/sources/beacon/documents";

export interface BeaconDate {
  utcDate?: string;
  specifiedZone?: string;
}

export interface BeaconSolicitation extends Record<string, unknown> {
  id: string;
  revisionId?: string;
  refnum?: string;
  title?: string;
  description?: unknown;
  status?: string;
  type?: string;
  publishedAt?: string;
  modifiedAt?: string;
  issueDate?: BeaconDate;
  dueDate?: BeaconDate;
  departments?: unknown[];
  categories?: unknown[];
  documents?: unknown[];
  agency?: unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(object: Record<string, unknown> | null, keys: string[]) {
  if (!object) return null;
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function toDate(value: unknown): Date | null {
  let candidate: string | null = null;
  if (typeof value === "string") candidate = value;
  const object = asObject(value);
  if (object) candidate = firstString(object, ["utcDate", "date", "value"]);
  if (!candidate) return null;

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return firstString(asObject(value), ["html", "text", "plainText", "value"]);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const strings = value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      return firstString(asObject(entry), [
        "name",
        "title",
        "label",
        "code",
        "description",
      ]);
    })
    .filter((entry): entry is string => Boolean(entry));

  return [...new Set(strings)];
}

function toNonNegativeInteger(value: unknown): number | null {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(candidate) && candidate >= 0 ? Math.trunc(candidate) : null;
}

function normalizeDocuments(value: unknown): PersistableDocument[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const document = asObject(entry);
    if (!document) return [];

    const beaconKey = firstString(document, ["key"]);
    const sourceDocumentId = firstString(document, ["id", "documentId", "uuid"]);
    const url = firstString(document, ["url", "downloadUrl", "href", "fileUrl"]);
    const name =
      firstString(document, ["name", "title", "filename", "fileName", "label"]) ??
      sourceDocumentId ??
      beaconKey ??
      "Document";
    const mimeType = firstString(document, ["type", "mimeType", "contentType"]);
    const fileSizeBytes = toNonNegativeInteger(
      document.bytes ?? document.size ?? document.fileSize ?? document.fileSizeBytes,
    );
    const sourceDocumentKey =
      beaconKey ?? sourceDocumentId ?? url ?? `${name}:${hashPayload(document).slice(0, 16)}`;

    return [
      enrichBeaconDocumentMetadata({
        sourceDocumentKey,
        sourceDocumentId,
        name,
        url,
        mimeType,
        fileSizeBytes,
        sourceMetadata: document,
      }),
    ];
  });
}

/**
 * Beacon can supply mandatory response templates inside eBid questionnaire
 * attachments rather than in solicitation.documents. They are original source
 * files, not model-generated forms, and must be present in the snapshot.
 */
function normalizeEbidFormAttachments(ebid: unknown): PersistableDocument[] {
  const eforms = asObject(ebid)?.eforms;
  if (!Array.isArray(eforms)) return [];
  return eforms.flatMap((entry) => {
    const form = asObject(entry);
    if (!form || !Array.isArray(form.questions)) return [];
    return form.questions.flatMap((questionEntry: unknown) => {
      const question = asObject(questionEntry);
      if (!question || !Array.isArray(question.attachments)) return [];
      return normalizeDocuments(question.attachments).map((document) => ({
        ...document,
        sourceMetadata: {
          ...document.sourceMetadata,
          requiredOriginalForm: question.required === true,
          formName: firstString(form,["name","title"]) ?? "Source response form",
          formQuestion: firstString(question,["prompt","text"]) ?? null,
          sourceLocation: "ebid.eforms.questions.attachments",
        },
      }));
    });
  });
}

function normalizeClassifications(value: unknown): PersistableClassification[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const classification = asObject(entry);
    if (!classification) return [];

    const scheme =
      firstString(classification, ["type", "scheme", "system"])?.toLowerCase() ??
      "unknown";
    const code = firstString(classification, ["code", "id", "value"]);
    const name =
      firstString(classification, ["name", "title", "label", "description"]) ??
      code ??
      "Unlabeled classification";
    const sourceClassificationKey = code
      ? `${scheme}:${code}`
      : `${scheme}:${hashPayload(classification).slice(0, 16)}`;

    return [
      {
        sourceClassificationKey,
        scheme,
        code,
        name,
        sourceMetadata: classification,
      },
    ];
  });
}

function identifyBeaconSolicitation(row: BeaconSolicitation) {
  const sourceRecordId = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
  if (!sourceRecordId) throw new Error("Beacon solicitation is missing a stable id");

  return {
    sourceRecordId,
    sourceRevisionId: row.revisionId ?? null,
  };
}

function buildBeaconSourceRecord(input: {
  row: BeaconSolicitation;
  canonicalUrl: string;
}): PersistableSourceRecord {
  const identity = identifyBeaconSolicitation(input.row);
  return {
    ...identity,
    sourceModifiedAt: toDate(input.row.modifiedAt),
    canonicalUrl: input.canonicalUrl,
    rawPayload: input.row,
  };
}

function buildNormalizedBeaconSolicitation(input: {
  row: BeaconSolicitation;
  canonicalUrl: string;
  agencySlug: string;
  canonicalStatus: string;
}): PersistableOpportunityRecord {
  const { row } = input;
  const sourceRecord = buildBeaconSourceRecord({ row, canonicalUrl: input.canonicalUrl });
  const agency = asObject(row.agency);
  const agencyName =
    firstString(agency, ["name", "title", "displayName"]) ??
    (input.agencySlug === "city-of-houston" ? "City of Houston" : input.agencySlug);
  const classifications = normalizeClassifications(row.categories);

  return {
    ...sourceRecord,
    solicitationNumber: row.refnum ?? null,
    title: row.title?.trim() || row.refnum || row.id,
    description: normalizeDescription(row.description),
    status: input.canonicalStatus,
    sourceStatus: row.status ?? null,
    opportunityType: row.type ?? null,
    agencyName,
    agencySlug: input.agencySlug,
    departments: toStringList(row.departments),
    categories: [...new Set(classifications.map((classification) => classification.name))],
    classifications,
    publishedAt: toDate(row.publishedAt),
    issueAt: toDate(row.issueDate),
    dueAt: toDate(row.dueDate),
    location:
      input.agencySlug === "city-of-houston"
        ? { locality: "Houston", region: "TX", country: "US" }
        : {},
    documents: [...new Map([...normalizeDocuments(row.documents),
      ...normalizeEbidFormAttachments(row.ebid)]
      .map((document) => [document.sourceDocumentKey,document])).values()],
  };
}

function requireBeaconCanonicalUrl(context: ProcurementSourceContext) {
  const canonicalUrl = context.canonicalUrl?.trim();
  if (!canonicalUrl) throw new Error("Beacon source adapter requires a canonical URL");
  return canonicalUrl;
}

export const beaconOpportunityAdapter: ProcurementSourceAdapter<BeaconSolicitation> = {
  source: "beacon",
  authority: "authoritative",
  identify: identifyBeaconSolicitation,
  toSourceRecord(row, context) {
    return buildBeaconSourceRecord({
      row,
      canonicalUrl: requireBeaconCanonicalUrl(context),
    });
  },
  normalizeOpportunity(row, context) {
    const agencySlug = context.agency?.trim();
    if (!agencySlug) throw new Error("Beacon source adapter requires an agency key");
    const canonicalStatus = context.canonicalStatus?.trim();
    if (!canonicalStatus) throw new Error("Beacon source adapter requires a canonical status");

    return buildNormalizedBeaconSolicitation({
      row,
      canonicalUrl: requireBeaconCanonicalUrl(context),
      agencySlug,
      canonicalStatus,
    });
  },
};

export function toBeaconSourceRecord(input: {
  row: BeaconSolicitation;
  canonicalUrl: string;
}): PersistableSourceRecord {
  return beaconOpportunityAdapter.toSourceRecord(input.row, {
    canonicalUrl: input.canonicalUrl,
  });
}

export function normalizeBeaconSolicitation(input: {
  row: BeaconSolicitation;
  canonicalUrl: string;
  agencySlug: string;
  canonicalStatus: string;
}): PersistableOpportunityRecord {
  return beaconOpportunityAdapter.normalizeOpportunity(input.row, {
    canonicalUrl: input.canonicalUrl,
    agency: input.agencySlug,
    canonicalStatus: input.canonicalStatus,
  });
}
