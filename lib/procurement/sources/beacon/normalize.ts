import { hashPayload, type PersistableDocument, type PersistableOpportunityRecord } from "@/lib/procurement/ingestion/persistence";

export interface BeaconDate {
  utcDate?: string;
  specifiedZone?: string;
}

export interface BeaconSolicitation extends Record<string, unknown> {
  id: string;
  revisionId?: string;
  refnum?: string;
  title?: string;
  description?: string;
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

function toDate(value: unknown): Date | null {
  let candidate: string | null = null;
  if (typeof value === "string") candidate = value;
  const object = asObject(value);
  if (object) candidate = firstString(object, ["utcDate", "date", "value"]);
  if (!candidate) return null;

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function normalizeDocuments(value: unknown): PersistableDocument[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const document = asObject(entry);
    if (!document) return [];

    const sourceDocumentId = firstString(document, ["id", "documentId", "uuid"]);
    const url = firstString(document, ["url", "downloadUrl", "href", "fileUrl"]);
    const name =
      firstString(document, ["name", "title", "filename", "fileName", "label"]) ??
      sourceDocumentId ??
      url ??
      "Document";
    const mimeType = firstString(document, ["mimeType", "contentType", "type"]);
    const rawSize = document.size ?? document.fileSize ?? document.fileSizeBytes;
    const fileSizeBytes =
      typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize >= 0
        ? Math.trunc(rawSize)
        : null;
    const sourceDocumentKey =
      sourceDocumentId ?? url ?? `${name}:${hashPayload(document).slice(0, 16)}`;

    return [
      {
        sourceDocumentKey,
        sourceDocumentId,
        name,
        url,
        mimeType,
        fileSizeBytes,
        sourceMetadata: document,
      },
    ];
  });
}

export function normalizeBeaconSolicitation(input: {
  row: BeaconSolicitation;
  canonicalUrl: string;
  agencySlug: string;
}): PersistableOpportunityRecord {
  const { row } = input;
  const agency = asObject(row.agency);
  const agencyName =
    firstString(agency, ["name", "title", "displayName"]) ??
    (input.agencySlug === "city-of-houston" ? "City of Houston" : input.agencySlug);

  return {
    sourceRecordId: row.id.toLowerCase(),
    sourceRevisionId: row.revisionId ?? null,
    sourceModifiedAt: toDate(row.modifiedAt),
    canonicalUrl: input.canonicalUrl,
    rawPayload: row,
    solicitationNumber: row.refnum ?? null,
    title: row.title?.trim() || row.refnum || row.id,
    description: row.description ?? null,
    status: row.status ?? null,
    opportunityType: row.type ?? null,
    agencyName,
    agencySlug: input.agencySlug,
    departments: toStringList(row.departments),
    categories: toStringList(row.categories),
    publishedAt: toDate(row.publishedAt),
    issueAt: toDate(row.issueDate),
    dueAt: toDate(row.dueDate),
    location:
      input.agencySlug === "city-of-houston"
        ? { locality: "Houston", region: "TX", country: "US" }
        : {},
    documents: normalizeDocuments(row.documents),
  };
}
