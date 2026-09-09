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

export function resolveBeaconDocumentUrl(input: {
  sourceDocumentKey: string;
  sourceMetadata: Record<string, unknown>;
  existingUrl?: string | null;
}) {
  if (input.existingUrl?.trim()) return input.existingUrl.trim();

  const bucket = firstString(input.sourceMetadata, ["bucket"]);
  const key = firstString(input.sourceMetadata, ["key"]) ?? input.sourceDocumentKey;
  if (!bucket || !key) return null;

  const base = /^https?:\/\//i.test(bucket) ? bucket : `https://${bucket}`;
  const normalizedBase = base.replace(/\/+$/, "");
  const encodedKey = key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return encodedKey ? `${normalizedBase}/${encodedKey}` : null;
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
    url: resolveBeaconDocumentUrl({
      sourceDocumentKey: document.sourceDocumentKey,
      sourceMetadata: document.sourceMetadata,
      existingUrl: document.url,
    }),
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
