import type { PersistableDocument } from "@/lib/procurement/documents/persistence";

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

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveBeaconDocumentUrl(input: { existingUrl?: string | null }) {
  return input.existingUrl?.trim() || null;
}

export function resolveBeaconDocumentDownloadUrl(input: {
  sourceOpportunityId: string;
  sourceDocumentKey: string;
}) {
  const opportunityId = input.sourceOpportunityId.trim();
  const documentKey = input.sourceDocumentKey.trim();
  if (!opportunityId || !documentKey) return null;

  return `https://www.beaconbid.com/api/planholder/document/${encodeURIComponent(opportunityId)}/${encodeURIComponent(documentKey)}`;
}

const AMENDMENT_PATTERN =
  /\b(addendum|amendment|amended|revision|revised|change\s+notice|clarification|supplement)\b/i;

export function classifyBeaconAmendment(input: {
  name: string;
  sourceMetadata: Record<string, unknown>;
}) {
  const detail = firstString(input.sourceMetadata, ["detail", "documentType", "category"]);
  const candidate = [input.name, detail].filter(Boolean).join(" ");
  const isAmendment = AMENDMENT_PATTERN.test(candidate);

  return {
    isAmendment,
    amendmentLabel: isAmendment ? detail ?? input.name : null,
  };
}

export function enrichBeaconDocumentMetadata(document: PersistableDocument): PersistableDocument {
  const amendment = classifyBeaconAmendment({
    name: document.name,
    sourceMetadata: document.sourceMetadata,
  });

  return {
    ...document,
    // Beacon's `bucket` metadata identifies a private S3 bucket; it is not a public hostname.
    // Only preserve source URLs explicitly supplied by Beacon. Runtime downloads use the
    // access-controlled /api/planholder/document route instead.
    url: resolveBeaconDocumentUrl({ existingUrl: document.url }),
    sourceModifiedAt:
      document.sourceModifiedAt ?? parseDate(asObject(document.sourceMetadata)?.createdAt),
    isAmendment: document.isAmendment ?? amendment.isAmendment,
    amendmentLabel: document.amendmentLabel ?? amendment.amendmentLabel,
  };
}

export function normalizeBeaconEtag(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
  return normalized || null;
}
