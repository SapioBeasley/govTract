import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import {
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";
import {
  opportunities,
  opportunityClassifications,
  opportunityDocuments,
  opportunityDocumentVersions,
  sourceRecords,
} from "@/lib/db/schema";
import { isSupportedDocumentType } from "@/lib/procurement/documents/persistence";

export type OpportunityDetailClassification = {
  id: string;
  scheme: string;
  code: string | null;
  name: string;
};

export type OpportunityDocumentExtractionState =
  | "pending"
  | "extracted"
  | "failed"
  | "unsupported"
  | "stale";

export type OpportunityDetailDocument = {
  id: string;
  sourceDocumentKey: string;
  sourceDocumentId: string | null;
  name: string;
  url: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sourceMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  extractionState: OpportunityDocumentExtractionState;
  latestVersion: {
    id: string;
    versionNumber: number;
    checksumSha256: string | null;
    retrievedAt: Date | null;
  } | null;
  extraction: {
    id: string;
    status: string;
    checksumSha256: string;
    extractorName: string;
    extractorVersion: string;
    extractedByteCount: number;
    extractedCharCount: number;
    segmentCount: number;
    truncated: boolean;
    failureCode: string | null;
    completedAt: Date | null;
  } | null;
};

export type OpportunityDetail = {
  id: string;
  sourceRecordId: string;
  source: string;
  sourceOpportunityId: string;
  sourceRevisionId: string | null;
  solicitationNumber: string | null;
  title: string;
  description: string | null;
  status: string | null;
  sourceStatus: string | null;
  opportunityType: string | null;
  agencyName: string | null;
  agencySlug: string | null;
  departments: string[];
  categories: string[];
  publishedAt: Date | null;
  issueAt: Date | null;
  dueAt: Date | null;
  canonicalUrl: string | null;
  location: Record<string, unknown>;
  isActive: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
  classifications: OpportunityDetailClassification[];
  documents: OpportunityDetailDocument[];
  sourceRecord: {
    sourceRecordId: string;
    sourceRevisionId: string | null;
    sourceModifiedAt: Date | null;
    sourceAgency: string | null;
    canonicalUrl: string | null;
    payloadHash: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    isActive: boolean;
  } | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getOpportunityDetail = cache(async (id: string): Promise<OpportunityDetail | null> => {
  if (!UUID_PATTERN.test(id)) return null;

  const db = getDb();
  const [opportunity] = await db
    .select({
      id: opportunities.id,
      sourceRecordId: opportunities.sourceRecordId,
      source: opportunities.source,
      sourceOpportunityId: opportunities.sourceOpportunityId,
      sourceRevisionId: opportunities.sourceRevisionId,
      solicitationNumber: opportunities.solicitationNumber,
      title: opportunities.title,
      description: opportunities.description,
      status: opportunities.status,
      sourceStatus: opportunities.sourceStatus,
      opportunityType: opportunities.opportunityType,
      agencyName: opportunities.agencyName,
      agencySlug: opportunities.agencySlug,
      departments: opportunities.departments,
      categories: opportunities.categories,
      publishedAt: opportunities.publishedAt,
      issueAt: opportunities.issueAt,
      dueAt: opportunities.dueAt,
      canonicalUrl: opportunities.canonicalUrl,
      location: opportunities.location,
      isActive: opportunities.isActive,
      firstSeenAt: opportunities.firstSeenAt,
      lastSeenAt: opportunities.lastSeenAt,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!opportunity) return null;

  const [classifications, documentRows, sourceRecordRows] = await Promise.all([
    db
      .select({
        id: opportunityClassifications.id,
        scheme: opportunityClassifications.scheme,
        code: opportunityClassifications.code,
        name: opportunityClassifications.name,
      })
      .from(opportunityClassifications)
      .where(eq(opportunityClassifications.opportunityId, opportunity.id))
      .orderBy(
        asc(opportunityClassifications.scheme),
        asc(opportunityClassifications.code),
        asc(opportunityClassifications.name),
      ),
    db
      .select({
        id: opportunityDocuments.id,
        sourceDocumentKey: opportunityDocuments.sourceDocumentKey,
        sourceDocumentId: opportunityDocuments.sourceDocumentId,
        name: opportunityDocuments.name,
        url: opportunityDocuments.url,
        mimeType: opportunityDocuments.mimeType,
        fileSizeBytes: opportunityDocuments.fileSizeBytes,
        sourceMetadata: opportunityDocuments.sourceMetadata,
        createdAt: opportunityDocuments.createdAt,
        updatedAt: opportunityDocuments.updatedAt,
      })
      .from(opportunityDocuments)
      .where(
        and(
          eq(opportunityDocuments.opportunityId, opportunity.id),
          eq(opportunityDocuments.isActive, true),
        ),
      )
      .orderBy(asc(opportunityDocuments.name)),
    db
      .select({
        sourceRecordId: sourceRecords.sourceRecordId,
        sourceRevisionId: sourceRecords.sourceRevisionId,
        sourceModifiedAt: sourceRecords.sourceModifiedAt,
        sourceAgency: sourceRecords.sourceAgency,
        canonicalUrl: sourceRecords.canonicalUrl,
        payloadHash: sourceRecords.payloadHash,
        firstSeenAt: sourceRecords.firstSeenAt,
        lastSeenAt: sourceRecords.lastSeenAt,
        isActive: sourceRecords.isActive,
      })
      .from(sourceRecords)
      .where(eq(sourceRecords.id, opportunity.sourceRecordId))
      .limit(1),
  ]);

  const documentIds = documentRows.map((document) => document.id);
  const versionRows = documentIds.length
    ? await db
        .select({
          id: opportunityDocumentVersions.id,
          opportunityDocumentId: opportunityDocumentVersions.opportunityDocumentId,
          versionNumber: opportunityDocumentVersions.versionNumber,
          checksumSha256: opportunityDocumentVersions.checksumSha256,
          retrievedAt: opportunityDocumentVersions.retrievedAt,
        })
        .from(opportunityDocumentVersions)
        .where(inArray(opportunityDocumentVersions.opportunityDocumentId, documentIds))
        .orderBy(desc(opportunityDocumentVersions.versionNumber))
    : [];

  const versionIds = versionRows.map((version) => version.id);
  const extractionRows = versionIds.length
    ? await db
        .select({
          opportunityDocumentVersionId:
            opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
          id: documentExtractions.id,
          status: documentExtractions.status,
          checksumSha256: documentExtractions.checksumSha256,
          extractorName: documentExtractions.extractorName,
          extractorVersion: documentExtractions.extractorVersion,
          extractedByteCount: documentExtractions.extractedByteCount,
          extractedCharCount: documentExtractions.extractedCharCount,
          segmentCount: documentExtractions.segmentCount,
          truncated: documentExtractions.truncated,
          failureCode: documentExtractions.failureCode,
          completedAt: documentExtractions.completedAt,
          updatedAt: documentExtractions.updatedAt,
        })
        .from(opportunityDocumentVersionExtractions)
        .innerJoin(
          documentExtractions,
          eq(
            opportunityDocumentVersionExtractions.documentExtractionId,
            documentExtractions.id,
          ),
        )
        .where(
          inArray(
            opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
            versionIds,
          ),
        )
        .orderBy(desc(documentExtractions.updatedAt))
    : [];

  const latestVersionByDocument = new Map<string, (typeof versionRows)[number]>();
  const documentIdByVersion = new Map<string, string>();
  for (const version of versionRows) {
    documentIdByVersion.set(version.id, version.opportunityDocumentId);
    if (!latestVersionByDocument.has(version.opportunityDocumentId)) {
      latestVersionByDocument.set(version.opportunityDocumentId, version);
    }
  }

  const extractionsByVersion = new Map<string, typeof extractionRows>();
  const historicalExtractionByDocument = new Set<string>();
  for (const extraction of extractionRows) {
    const current = extractionsByVersion.get(extraction.opportunityDocumentVersionId) ?? [];
    current.push(extraction);
    extractionsByVersion.set(extraction.opportunityDocumentVersionId, current);
    const documentId = documentIdByVersion.get(extraction.opportunityDocumentVersionId);
    if (documentId && ["extracted", "truncated"].includes(extraction.status)) {
      historicalExtractionByDocument.add(documentId);
    }
  }

  const documents: OpportunityDetailDocument[] = documentRows.map((document) => {
    const latestVersion = latestVersionByDocument.get(document.id) ?? null;
    const currentExtractions = latestVersion
      ? extractionsByVersion.get(latestVersion.id) ?? []
      : [];
    const matchingExtraction =
      currentExtractions.find(
        (extraction) =>
          latestVersion?.checksumSha256 &&
          extraction.checksumSha256 === latestVersion.checksumSha256,
      ) ?? null;

    let extractionState: OpportunityDocumentExtractionState;
    if (!isSupportedDocumentType(document)) {
      extractionState = "unsupported";
    } else if (matchingExtraction?.status === "failed") {
      extractionState = "failed";
    } else if (
      matchingExtraction &&
      ["extracted", "truncated"].includes(matchingExtraction.status)
    ) {
      extractionState = "extracted";
    } else if (matchingExtraction?.status === "pending") {
      extractionState = "pending";
    } else if (historicalExtractionByDocument.has(document.id)) {
      extractionState = "stale";
    } else {
      extractionState = "pending";
    }

    return {
      ...document,
      extractionState,
      latestVersion: latestVersion
        ? {
            id: latestVersion.id,
            versionNumber: latestVersion.versionNumber,
            checksumSha256: latestVersion.checksumSha256,
            retrievedAt: latestVersion.retrievedAt,
          }
        : null,
      extraction: matchingExtraction
        ? {
            id: matchingExtraction.id,
            status: matchingExtraction.status,
            checksumSha256: matchingExtraction.checksumSha256,
            extractorName: matchingExtraction.extractorName,
            extractorVersion: matchingExtraction.extractorVersion,
            extractedByteCount: matchingExtraction.extractedByteCount,
            extractedCharCount: matchingExtraction.extractedCharCount,
            segmentCount: matchingExtraction.segmentCount,
            truncated: matchingExtraction.truncated,
            failureCode: matchingExtraction.failureCode,
            completedAt: matchingExtraction.completedAt,
          }
        : null,
    };
  });

  return {
    ...opportunity,
    classifications,
    documents,
    sourceRecord: sourceRecordRows[0] ?? null,
  };
});
