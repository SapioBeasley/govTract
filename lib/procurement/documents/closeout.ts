import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  documentExtractionCloseouts,
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";
import {
  opportunities,
  opportunityDocuments,
  opportunityDocumentVersions,
} from "@/lib/db/schema";
import { isSupportedDocumentType } from "@/lib/procurement/documents/persistence";

export type DocumentCloseoutStatus = "pending" | "covered" | "unsupported" | "failed";

export type DocumentCloseoutCandidate = {
  closeoutId: string;
  closeoutStatus: DocumentCloseoutStatus;
  documentId: string;
  documentVersionId: string;
  checksumSha256: string | null;
  opportunityId: string;
  sourceOpportunityId: string;
  sourceDocumentKey: string;
  sourceDocumentId: string | null;
  name: string;
  url: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sourceMetadata: Record<string, unknown>;
};

function linkedCoverageStatus(statuses: string[]): DocumentCloseoutStatus | null {
  if (statuses.some((status) => status === "extracted" || status === "truncated")) {
    return "covered";
  }
  if (statuses.some((status) => status === "failed")) return "failed";
  return null;
}

export async function queueDocumentCloseoutsForInactiveTransitions(input: {
  opportunityIds: string[];
  triggerSource: string;
  triggerAgency?: string;
}) {
  if (input.opportunityIds.length === 0) {
    return { queued: 0, pending: 0, covered: 0, unsupported: 0, failed: 0 };
  }

  const db = getDb();
  const versionRows = await db
    .select({
      opportunityId: opportunityDocuments.opportunityId,
      documentId: opportunityDocuments.id,
      versionId: opportunityDocumentVersions.id,
      versionNumber: opportunityDocumentVersions.versionNumber,
      name: opportunityDocumentVersions.name,
      mimeType: opportunityDocumentVersions.mimeType,
    })
    .from(opportunityDocuments)
    .innerJoin(
      opportunityDocumentVersions,
      eq(opportunityDocumentVersions.opportunityDocumentId, opportunityDocuments.id),
    )
    .where(inArray(opportunityDocuments.opportunityId, input.opportunityIds))
    .orderBy(asc(opportunityDocuments.id), desc(opportunityDocumentVersions.versionNumber));

  const latestByDocument = new Map<string, (typeof versionRows)[number]>();
  for (const row of versionRows) {
    if (!latestByDocument.has(row.documentId)) latestByDocument.set(row.documentId, row);
  }
  const latestVersions = [...latestByDocument.values()];
  if (latestVersions.length === 0) {
    return { queued: 0, pending: 0, covered: 0, unsupported: 0, failed: 0 };
  }

  const versionIds = latestVersions.map((row) => row.versionId);
  const extractionRows = await db
    .select({
      versionId: opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
      status: documentExtractions.status,
    })
    .from(opportunityDocumentVersionExtractions)
    .innerJoin(
      documentExtractions,
      eq(opportunityDocumentVersionExtractions.documentExtractionId, documentExtractions.id),
    )
    .where(inArray(opportunityDocumentVersionExtractions.opportunityDocumentVersionId, versionIds));

  const statusesByVersion = new Map<string, string[]>();
  for (const row of extractionRows) {
    const statuses = statusesByVersion.get(row.versionId) ?? [];
    statuses.push(row.status);
    statusesByVersion.set(row.versionId, statuses);
  }

  const counts = { queued: 0, pending: 0, covered: 0, unsupported: 0, failed: 0 };
  const now = new Date();
  for (const row of latestVersions) {
    const supported = isSupportedDocumentType({ name: row.name, mimeType: row.mimeType });
    const status: DocumentCloseoutStatus = !supported
      ? "unsupported"
      : linkedCoverageStatus(statusesByVersion.get(row.versionId) ?? []) ?? "pending";
    const completedAt = status === "pending" ? null : now;

    const inserted = await db
      .insert(documentExtractionCloseouts)
      .values({
        opportunityId: row.opportunityId,
        opportunityDocumentId: row.documentId,
        opportunityDocumentVersionId: row.versionId,
        status,
        reason: "opportunity_inactive",
        triggerSource: input.triggerSource,
        triggerAgency: input.triggerAgency,
        completedAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: documentExtractionCloseouts.opportunityDocumentVersionId })
      .returning({ id: documentExtractionCloseouts.id });

    if (inserted.length === 0) continue;
    counts.queued += 1;
    counts[status] += 1;
  }

  return counts;
}

export async function listDocumentCloseoutCandidates(input: {
  source: string;
  agency?: string;
  limit: number;
  retryFailed: boolean;
}): Promise<DocumentCloseoutCandidate[]> {
  if (input.limit <= 0) return [];

  const db = getDb();
  const statusCondition = input.retryFailed
    ? or(
        eq(documentExtractionCloseouts.status, "pending"),
        eq(documentExtractionCloseouts.status, "failed"),
      )!
    : eq(documentExtractionCloseouts.status, "pending");
  const conditions: SQL[] = [eq(opportunities.source, input.source), statusCondition];
  if (input.agency) conditions.push(eq(opportunities.agencySlug, input.agency));

  const rows = await db
    .select({
      closeoutId: documentExtractionCloseouts.id,
      closeoutStatus: documentExtractionCloseouts.status,
      documentId: opportunityDocuments.id,
      documentVersionId: opportunityDocumentVersions.id,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
      opportunityId: opportunities.id,
      sourceOpportunityId: opportunities.sourceOpportunityId,
      sourceDocumentKey: opportunityDocuments.sourceDocumentKey,
      sourceDocumentId: opportunityDocuments.sourceDocumentId,
      name: opportunityDocuments.name,
      url: opportunityDocuments.url,
      mimeType: opportunityDocuments.mimeType,
      fileSizeBytes: opportunityDocuments.fileSizeBytes,
      sourceMetadata: opportunityDocuments.sourceMetadata,
    })
    .from(documentExtractionCloseouts)
    .innerJoin(opportunities, eq(opportunities.id, documentExtractionCloseouts.opportunityId))
    .innerJoin(
      opportunityDocuments,
      eq(opportunityDocuments.id, documentExtractionCloseouts.opportunityDocumentId),
    )
    .innerJoin(
      opportunityDocumentVersions,
      eq(opportunityDocumentVersions.id, documentExtractionCloseouts.opportunityDocumentVersionId),
    )
    .where(and(...conditions))
    .orderBy(asc(documentExtractionCloseouts.requestedAt), asc(documentExtractionCloseouts.id))
    .limit(input.limit);

  return rows.map((row) => ({
    ...row,
    closeoutStatus: row.closeoutStatus as DocumentCloseoutStatus,
  }));
}

export async function updateDocumentCloseoutStatus(input: {
  closeoutId: string;
  status: DocumentCloseoutStatus;
  failureCode?: string | null;
}) {
  const now = new Date();
  await getDb()
    .update(documentExtractionCloseouts)
    .set({
      status: input.status,
      failureCode: input.failureCode ?? null,
      completedAt: input.status === "pending" ? null : now,
      updatedAt: now,
    })
    .where(eq(documentExtractionCloseouts.id, input.closeoutId));
}
