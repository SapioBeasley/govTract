import { asc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import {
  opportunities,
  opportunityClassifications,
  opportunityDocuments,
  sourceRecords,
} from "@/lib/db/schema";

export type OpportunityDetailClassification = {
  id: string;
  scheme: string;
  code: string | null;
  name: string;
};

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

  const [classifications, documents, sourceRecordRows] = await Promise.all([
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
      .where(eq(opportunityDocuments.opportunityId, opportunity.id))
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

  return {
    ...opportunity,
    classifications,
    documents,
    sourceRecord: sourceRecordRows[0] ?? null,
  };
});
