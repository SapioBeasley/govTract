import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  documentExtractionSegments,
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";
import {
  solicitationUnderstandingChunks,
  solicitationUnderstandings,
} from "@/lib/db/solicitation-understandings-schema";
import { opportunityDocuments, opportunityDocumentVersions } from "@/lib/db/schema";
import { isSupportedDocumentType } from "@/lib/procurement/documents/persistence";

import type {
  UnderstandingDocumentInput,
  UnderstandingExtractionStatus,
  UnderstandingSegmentInput,
} from "./planning";

type VersionRow = {
  documentId: string;
  documentVersionId: string;
  versionNumber: number;
  fingerprint: string;
  checksumSha256: string | null;
  name: string;
  mimeType: string | null;
};

type ExtractionRow = {
  documentVersionId: string;
  extractionId: string;
  extractorName: string;
  extractorVersion: string;
  extractionStatus: string;
  truncated: boolean;
  extractionCreatedAt: Date;
  segmentId: string | null;
  segmentOrdinal: number | null;
  segmentContent: string | null;
  segmentContentHashSha256: string | null;
};

function latestVersions(rows: VersionRow[]) {
  const latest = new Map<string, VersionRow>();
  for (const row of rows) {
    if (!latest.has(row.documentId)) latest.set(row.documentId, row);
  }
  return [...latest.values()].sort((a, b) => a.documentVersionId.localeCompare(b.documentVersionId));
}

function extractionRank(status: string) {
  if (status === "extracted" || status === "truncated") return 0;
  if (status === "pending") return 1;
  return 2;
}

function mapExtractionStatus(status: string): UnderstandingExtractionStatus {
  if (status === "extracted" || status === "truncated") return "extracted";
  if (status === "failed") return "failed";
  return "pending";
}

function chooseExtraction(rows: ExtractionRow[]) {
  const byExtraction = new Map<string, ExtractionRow[]>();
  for (const row of rows) {
    const group = byExtraction.get(row.extractionId) ?? [];
    group.push(row);
    byExtraction.set(row.extractionId, group);
  }

  return [...byExtraction.values()].sort((a, b) => {
    const firstA = a[0]!;
    const firstB = b[0]!;
    return (
      extractionRank(firstA.extractionStatus) - extractionRank(firstB.extractionStatus) ||
      firstB.extractionCreatedAt.getTime() - firstA.extractionCreatedAt.getTime() ||
      firstA.extractionId.localeCompare(firstB.extractionId)
    );
  })[0];
}

function mapSegments(rows: ExtractionRow[]): UnderstandingSegmentInput[] {
  return rows
    .filter(
      (row) =>
        row.segmentId !== null &&
        row.segmentOrdinal !== null &&
        row.segmentContent !== null &&
        row.segmentContentHashSha256 !== null,
    )
    .sort(
      (a, b) =>
        (a.segmentOrdinal ?? 0) - (b.segmentOrdinal ?? 0) ||
        (a.segmentId ?? "").localeCompare(b.segmentId ?? ""),
    )
    .map((row) => ({
      id: row.segmentId!,
      ordinal: row.segmentOrdinal!,
      content: row.segmentContent!,
      contentHashSha256: row.segmentContentHashSha256!,
    }));
}

export async function loadPersistedUnderstandingDocuments(
  opportunityId: string,
): Promise<UnderstandingDocumentInput[]> {
  const db = getDb();
  const versionRows = await db
    .select({
      documentId: opportunityDocuments.id,
      documentVersionId: opportunityDocumentVersions.id,
      versionNumber: opportunityDocumentVersions.versionNumber,
      fingerprint: opportunityDocumentVersions.fingerprint,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
      name: opportunityDocumentVersions.name,
      mimeType: opportunityDocumentVersions.mimeType,
    })
    .from(opportunityDocuments)
    .innerJoin(
      opportunityDocumentVersions,
      eq(opportunityDocumentVersions.opportunityDocumentId, opportunityDocuments.id),
    )
    .where(
      and(eq(opportunityDocuments.opportunityId, opportunityId), eq(opportunityDocuments.isActive, true)),
    )
    .orderBy(
      asc(opportunityDocuments.id),
      desc(opportunityDocumentVersions.versionNumber),
      asc(opportunityDocumentVersions.id),
    );

  const versions = latestVersions(versionRows);
  if (versions.length === 0) return [];
  const versionIds = versions.map((row) => row.documentVersionId);

  const extractionRows = await db
    .select({
      documentVersionId: opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
      extractionId: documentExtractions.id,
      extractorName: documentExtractions.extractorName,
      extractorVersion: documentExtractions.extractorVersion,
      extractionStatus: documentExtractions.status,
      truncated: documentExtractions.truncated,
      extractionCreatedAt: documentExtractions.createdAt,
      segmentId: documentExtractionSegments.id,
      segmentOrdinal: documentExtractionSegments.ordinal,
      segmentContent: documentExtractionSegments.content,
      segmentContentHashSha256: documentExtractionSegments.contentHashSha256,
    })
    .from(opportunityDocumentVersionExtractions)
    .innerJoin(
      documentExtractions,
      eq(documentExtractions.id, opportunityDocumentVersionExtractions.documentExtractionId),
    )
    .leftJoin(
      documentExtractionSegments,
      eq(documentExtractionSegments.documentExtractionId, documentExtractions.id),
    )
    .where(inArray(opportunityDocumentVersionExtractions.opportunityDocumentVersionId, versionIds))
    .orderBy(
      asc(opportunityDocumentVersionExtractions.opportunityDocumentVersionId),
      desc(documentExtractions.createdAt),
      asc(documentExtractionSegments.ordinal),
    );

  const extractionsByVersion = new Map<string, ExtractionRow[]>();
  for (const row of extractionRows) {
    const group = extractionsByVersion.get(row.documentVersionId) ?? [];
    group.push(row);
    extractionsByVersion.set(row.documentVersionId, group);
  }

  return versions.map((version) => {
    const extraction = chooseExtraction(extractionsByVersion.get(version.documentVersionId) ?? []);
    const supported = isSupportedDocumentType({ name: version.name, mimeType: version.mimeType });

    if (!extraction) {
      return {
        documentVersionId: version.documentVersionId,
        extractionId: null,
        checksumSha256: version.checksumSha256 ?? version.fingerprint,
        extractorName: supported ? "pending" : "unsupported",
        extractorVersion: "0",
        extractionStatus: supported ? ("pending" as const) : ("unsupported" as const),
        truncated: false,
        segments: [],
      };
    }

    const head = extraction[0]!;
    return {
      documentVersionId: version.documentVersionId,
      extractionId: head.extractionId,
      checksumSha256: version.checksumSha256 ?? version.fingerprint,
      extractorName: head.extractorName,
      extractorVersion: head.extractorVersion,
      extractionStatus: mapExtractionStatus(head.extractionStatus),
      truncated: head.truncated || head.extractionStatus === "truncated",
      segments: mapSegments(extraction),
    };
  });
}

export async function loadReusableUnderstandingChunkFingerprints(opportunityId: string) {
  const db = getDb();
  const rows = await db
    .select({ inputFingerprint: solicitationUnderstandingChunks.inputFingerprint })
    .from(solicitationUnderstandingChunks)
    .innerJoin(
      solicitationUnderstandings,
      eq(solicitationUnderstandings.id, solicitationUnderstandingChunks.solicitationUnderstandingId),
    )
    .where(
      and(
        eq(solicitationUnderstandings.opportunityId, opportunityId),
        inArray(solicitationUnderstandingChunks.status, ["processed", "reused"]),
        isNotNull(solicitationUnderstandingChunks.structuredOutput),
      ),
    )
    .orderBy(asc(solicitationUnderstandingChunks.inputFingerprint));

  return new Set(rows.map((row) => row.inputFingerprint));
}

export async function markUnderstandingStaleIfInputChanged(input: {
  understandingId: string;
  currentInputFingerprint: string;
}) {
  const db = getDb();
  const [existing] = await db
    .select({ inputFingerprint: solicitationUnderstandings.inputFingerprint })
    .from(solicitationUnderstandings)
    .where(eq(solicitationUnderstandings.id, input.understandingId))
    .limit(1);

  if (!existing) throw new Error("Solicitation understanding not found");
  if (existing.inputFingerprint === input.currentInputFingerprint) return false;

  const now = new Date();
  await db
    .update(solicitationUnderstandings)
    .set({
      isStale: true,
      staleAt: now,
      staleReason: "input_changed",
      updatedAt: now,
    })
    .where(eq(solicitationUnderstandings.id, input.understandingId));
  return true;
}
