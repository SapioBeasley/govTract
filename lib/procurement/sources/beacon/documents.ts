import type { PersistableDocument } from "@/lib/procurement/documents/persistence";

const BEACON_DOCUMENT_BUCKET = "documents.beaconbid.com";
const BEACON_PRESIGNED_S3_HOST = "s3.us-west-2.amazonaws.com";

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

function isAwsPresignedUrl(url: URL) {
  return (
    url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
    Boolean(url.searchParams.get("X-Amz-Credential")) &&
    Boolean(url.searchParams.get("X-Amz-Date")) &&
    Boolean(url.searchParams.get("X-Amz-Expires")) &&
    Boolean(url.searchParams.get("X-Amz-Signature")) &&
    Boolean(url.searchParams.get("X-Amz-SignedHeaders"))
  );
}

export function isBeaconPresignedDocumentUrl(input: {
  url: string;
  sourceDocumentKey: string;
}) {
  try {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.hostname !== BEACON_PRESIGNED_S3_HOST) return false;
    if (!isAwsPresignedUrl(url)) return false;

    const decodedPath = decodeURIComponent(url.pathname);
    return decodedPath === `/${BEACON_DOCUMENT_BUCKET}/${input.sourceDocumentKey}`;
  } catch {
    return false;
  }
}

export function resolveBeaconDocumentUrl(input: { existingUrl?: string | null }) {
  const raw = input.existingUrl?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.hostname === BEACON_DOCUMENT_BUCKET) return null;
    if (url.hostname === BEACON_PRESIGNED_S3_HOST && isAwsPresignedUrl(url)) return null;
    return raw;
  } catch {
    return null;
  }
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
    // Beacon's bucket metadata and short-lived AWS presigned URLs are transport details,
    // not durable source URLs. Runtime downloads use Beacon's access-controlled route.
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
