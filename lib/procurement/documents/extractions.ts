import { createHash } from "node:crypto";

export const DEFAULT_MAX_EXTRACTED_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_SEGMENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_SEGMENTS = 5_000;

export type ExtractionSegmentType = "document" | "page" | "sheet" | "section" | "table";

export type ExtractionSegmentInput = {
  segmentType: ExtractionSegmentType;
  locator?: Record<string, unknown>;
  content: string;
};

export type PreparedExtractionSegment = {
  ordinal: number;
  segmentType: ExtractionSegmentType;
  locator: Record<string, unknown>;
  content: string;
  contentHashSha256: string;
  charCount: number;
  byteCount: number;
  truncated: boolean;
};

export type PreparedExtraction = {
  segments: PreparedExtractionSegment[];
  extractedCharCount: number;
  extractedByteCount: number;
  truncated: boolean;
  truncationReason:
    | "document_byte_limit"
    | "segment_byte_limit"
    | "segment_count_limit"
    | "extractor_partial"
    | null;
};

function positiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Extraction limits must be positive integers");
  return value;
}

export function normalizeDocumentChecksum(checksumSha256: string) {
  const normalized = checksumSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("Document checksum must be a SHA-256 hex digest");
  return normalized;
}

export function buildDocumentExtractionIdentity(input: {
  checksumSha256: string;
  extractorName: string;
  extractorVersion: string;
}) {
  const extractorName = input.extractorName.trim();
  const extractorVersion = input.extractorVersion.trim();
  if (!extractorName) throw new Error("Extractor name is required");
  if (!extractorVersion) throw new Error("Extractor version is required");

  return {
    checksumSha256: normalizeDocumentChecksum(input.checksumSha256),
    extractorName,
    extractorVersion,
  };
}

function truncateUtf8(content: string, maxBytes: number) {
  const totalBytes = Buffer.byteLength(content, "utf8");
  if (totalBytes <= maxBytes) return { content, truncated: false };

  let byteCount = 0;
  let end = 0;
  for (const character of content) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteCount + characterBytes > maxBytes) break;
    byteCount += characterBytes;
    end += character.length;
  }

  return { content: content.slice(0, end), truncated: true };
}

export function prepareExtractionSegments(
  input: ExtractionSegmentInput[],
  limits: {
    maxExtractedBytes?: number;
    maxSegmentBytes?: number;
    maxSegments?: number;
    partialExtraction?: boolean;
  } = {},
): PreparedExtraction {
  const maxExtractedBytes = positiveInteger(limits.maxExtractedBytes, DEFAULT_MAX_EXTRACTED_BYTES);
  const maxSegmentBytes = positiveInteger(limits.maxSegmentBytes, DEFAULT_MAX_SEGMENT_BYTES);
  const maxSegments = positiveInteger(limits.maxSegments, DEFAULT_MAX_SEGMENTS);

  const segments: PreparedExtractionSegment[] = [];
  let extractedCharCount = 0;
  let extractedByteCount = 0;
  let truncationReason: PreparedExtraction["truncationReason"] =
    limits.partialExtraction === true ? "extractor_partial" : null;

  for (const source of input) {
    if (segments.length >= maxSegments) {
      truncationReason = "segment_count_limit";
      break;
    }

    const remainingDocumentBytes = maxExtractedBytes - extractedByteCount;
    if (remainingDocumentBytes <= 0) {
      truncationReason = "document_byte_limit";
      break;
    }

    const sourceBytes = Buffer.byteLength(source.content, "utf8");
    const allowedBytes = Math.min(maxSegmentBytes, remainingDocumentBytes);
    const bounded = truncateUtf8(source.content, allowedBytes);
    const content = bounded.content;
    const byteCount = Buffer.byteLength(content, "utf8");
    const documentWasByteLimited = sourceBytes > remainingDocumentBytes;

    segments.push({
      ordinal: segments.length,
      segmentType: source.segmentType,
      locator: source.locator ?? {},
      content,
      contentHashSha256: createHash("sha256").update(content, "utf8").digest("hex"),
      charCount: content.length,
      byteCount,
      truncated: bounded.truncated,
    });

    extractedCharCount += content.length;
    extractedByteCount += byteCount;

    if (bounded.truncated) {
      truncationReason = documentWasByteLimited ? "document_byte_limit" : "segment_byte_limit";
      if (documentWasByteLimited) break;
    }
  }

  return {
    segments,
    extractedCharCount,
    extractedByteCount,
    truncated: truncationReason !== null,
    truncationReason,
  };
}
