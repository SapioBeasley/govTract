import { createHash } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import {
  ingestionRecordErrors,
  ingestionRunPages,
  ingestionRuns,
  opportunities,
  opportunityClassifications,
  sourceRecords,
} from "@/lib/db/schema";
import {
  persistOpportunityDocumentSet,
  type PersistableDocument,
} from "@/lib/procurement/documents/persistence";

export type { PersistableDocument } from "@/lib/procurement/documents/persistence";

export type IngestionStatus = "running" | "complete" | "partial" | "failed";
export type SourceRecordChange = "inserted" | "updated" | "unchanged";

export interface PersistableClassification {
  sourceClassificationKey: string;
  scheme: string;
  code?: string | null;
  name: string;
  sourceMetadata: Record<string, unknown>;
}

export interface PersistableSourceRecord {
  sourceRecordId: string;
  sourceRevisionId?: string | null;
  sourceModifiedAt?: Date | null;
  canonicalUrl?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface PersistableOpportunityRecord extends PersistableSourceRecord {
  solicitationNumber?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  sourceStatus?: string | null;
  opportunityType?: string | null;
  agencyName?: string | null;
  agencySlug?: string | null;
  departments: string[];
  categories: string[];
  classifications?: PersistableClassification[];
  publishedAt?: Date | null;
  issueAt?: Date | null;
  dueAt?: Date | null;
  location?: Record<string, unknown>;
  documents?: PersistableDocument[];
}

export interface PagePersistenceCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function hashPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export async function startIngestionRun(input: {
  source: string;
  scope: string;
  agency?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const [run] = await db
    .insert(ingestionRuns)
    .values({
      source: input.source,
      scope: input.scope,
      agency: input.agency,
      status: "running",
      metadata: input.metadata ?? {},
    })
    .returning({ id: ingestionRuns.id });

  if (!run) throw new Error("Failed to create ingestion run");
  return run.id;
}

export async function persistRawIngestionPage(input: {
  runId: string;
  pageNumber: number;
  cursor: Record<string, unknown>;
  reportedTotal: number;
  rawPayload: Record<string, unknown>;
  recordCount: number;
}) {
  const db = getDb();
  const now = new Date();
  const payloadHash = hashPayload(input.rawPayload);

  await db
    .insert(ingestionRunPages)
    .values({
      ingestionRunId: input.runId,
      pageNumber: input.pageNumber,
      cursor: input.cursor,
      reportedTotal: input.reportedTotal,
      recordCount: input.recordCount,
      rawPayload: input.rawPayload,
      payloadHash,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [ingestionRunPages.ingestionRunId, ingestionRunPages.pageNumber],
      set: {
        cursor: input.cursor,
        reportedTotal: input.reportedTotal,
        recordCount: input.recordCount,
        rawPayload: input.rawPayload,
        payloadHash,
        fetchedAt: now,
      },
    });

  await db
    .update(ingestionRuns)
    .set({
      checkpoint: input.cursor,
      reportedTotal: input.reportedTotal,
      pagesFetched: input.pageNumber,
      updatedAt: now,
    })
    .where(eq(ingestionRuns.id, input.runId));
}

export async function persistSourceRecord(input: {
  runId: string;
  source: string;
  agency?: string;
  record: PersistableSourceRecord;
}): Promise<{ sourceRecordPk: string; change: SourceRecordChange }> {
  const db = getDb();
  const now = new Date();
  const recordHash = hashPayload(input.record.rawPayload);
  const [existing] = await db
    .select({ id: sourceRecords.id, payloadHash: sourceRecords.payloadHash })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.source, input.source),
        eq(sourceRecords.sourceRecordId, input.record.sourceRecordId),
      ),
    )
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(sourceRecords)
      .values({
        source: input.source,
        sourceRecordId: input.record.sourceRecordId,
        sourceRevisionId: input.record.sourceRevisionId,
        sourceModifiedAt: input.record.sourceModifiedAt,
        sourceAgency: input.agency,
        canonicalUrl: input.record.canonicalUrl,
        rawPayload: input.record.rawPayload,
        payloadHash: recordHash,
        firstSeenAt: now,
        lastSeenAt: now,
        lastIngestionRunId: input.runId,
        isActive: true,
        updatedAt: now,
      })
      .returning({ id: sourceRecords.id });

    if (!created) throw new Error(`Failed to insert source record ${input.record.sourceRecordId}`);
    return { sourceRecordPk: created.id, change: "inserted" };
  }

  if (existing.payloadHash !== recordHash) {
    await db
      .update(sourceRecords)
      .set({
        sourceRevisionId: input.record.sourceRevisionId,
        sourceModifiedAt: input.record.sourceModifiedAt,
        sourceAgency: input.agency,
        canonicalUrl: input.record.canonicalUrl,
        rawPayload: input.record.rawPayload,
        payloadHash: recordHash,
        lastSeenAt: now,
        lastIngestionRunId: input.runId,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(sourceRecords.id, existing.id));
    return { sourceRecordPk: existing.id, change: "updated" };
  }

  await db
    .update(sourceRecords)
    .set({
      lastSeenAt: now,
      lastIngestionRunId: input.runId,
      isActive: true,
    })
    .where(eq(sourceRecords.id, existing.id));
  return { sourceRecordPk: existing.id, change: "unchanged" };
}

export async function persistNormalizedOpportunity(input: {
  source: string;
  sourceRecordPk: string;
  record: PersistableOpportunityRecord;
}) {
  const db = getDb();
  const now = new Date();

  const [opportunity] = await db
    .insert(opportunities)
    .values({
      sourceRecordId: input.sourceRecordPk,
      source: input.source,
      sourceOpportunityId: input.record.sourceRecordId,
      sourceRevisionId: input.record.sourceRevisionId,
      solicitationNumber: input.record.solicitationNumber,
      title: input.record.title,
      description: input.record.description,
      status: input.record.status,
      sourceStatus: input.record.sourceStatus,
      opportunityType: input.record.opportunityType,
      agencyName: input.record.agencyName,
      agencySlug: input.record.agencySlug,
      departments: input.record.departments,
      categories: input.record.categories,
      publishedAt: input.record.publishedAt,
      issueAt: input.record.issueAt,
      dueAt: input.record.dueAt,
      canonicalUrl: input.record.canonicalUrl,
      location: input.record.location ?? {},
      isActive: true,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [opportunities.source, opportunities.sourceOpportunityId],
      set: {
        sourceRecordId: input.sourceRecordPk,
        sourceRevisionId: input.record.sourceRevisionId,
        solicitationNumber: input.record.solicitationNumber,
        title: input.record.title,
        description: input.record.description,
        status: input.record.status,
        sourceStatus: input.record.sourceStatus,
        opportunityType: input.record.opportunityType,
        agencyName: input.record.agencyName,
        agencySlug: input.record.agencySlug,
        departments: input.record.departments,
        categories: input.record.categories,
        publishedAt: input.record.publishedAt,
        issueAt: input.record.issueAt,
        dueAt: input.record.dueAt,
        canonicalUrl: input.record.canonicalUrl,
        location: input.record.location ?? {},
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: opportunities.id });

  if (!opportunity) throw new Error(`Failed to upsert opportunity ${input.record.sourceRecordId}`);

  await persistOpportunityDocumentSet({
    opportunityId: opportunity.id,
    documents: input.record.documents ?? [],
  });

  const classificationKeys: string[] = [];
  for (const classification of input.record.classifications ?? []) {
    classificationKeys.push(classification.sourceClassificationKey);
    await db
      .insert(opportunityClassifications)
      .values({
        opportunityId: opportunity.id,
        sourceClassificationKey: classification.sourceClassificationKey,
        scheme: classification.scheme,
        code: classification.code,
        name: classification.name,
        sourceMetadata: classification.sourceMetadata,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          opportunityClassifications.opportunityId,
          opportunityClassifications.sourceClassificationKey,
        ],
        set: {
          scheme: classification.scheme,
          code: classification.code,
          name: classification.name,
          sourceMetadata: classification.sourceMetadata,
          updatedAt: now,
        },
      });
  }

  if (classificationKeys.length > 0) {
    await db
      .delete(opportunityClassifications)
      .where(
        and(
          eq(opportunityClassifications.opportunityId, opportunity.id),
          notInArray(opportunityClassifications.sourceClassificationKey, classificationKeys),
        ),
      );
  } else {
    await db
      .delete(opportunityClassifications)
      .where(eq(opportunityClassifications.opportunityId, opportunity.id));
  }
}

export async function recordPagePersistenceCounts(input: {
  runId: string;
  counts: PagePersistenceCounts;
}) {
  const db = getDb();
  await db
    .update(ingestionRuns)
    .set({
      insertedCount: sql`${ingestionRuns.insertedCount} + ${input.counts.inserted}`,
      updatedCount: sql`${ingestionRuns.updatedCount} + ${input.counts.updated}`,
      unchangedCount: sql`${ingestionRuns.unchangedCount} + ${input.counts.unchanged}`,
      updatedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, input.runId));
}

export async function recordIngestionRecordError(input: {
  runId: string;
  pageNumber: number;
  sourceRecordId?: string | null;
  stage: string;
  error: string;
  rawPayload?: Record<string, unknown> | null;
}) {
  const db = getDb();
  await db.insert(ingestionRecordErrors).values({
    ingestionRunId: input.runId,
    pageNumber: input.pageNumber,
    sourceRecordId: input.sourceRecordId,
    stage: input.stage,
    error: input.error,
    rawPayload: input.rawPayload,
  });
  await db
    .update(ingestionRuns)
    .set({
      recordErrorCount: sql`${ingestionRuns.recordErrorCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, input.runId));
}

export async function reconcileCompleteScope(input: {
  source: string;
  agency?: string;
  seenSourceRecordIds: string[];
}) {
  if (input.seenSourceRecordIds.length === 0) return;

  const db = getDb();
  const now = new Date();
  const sourceRecordConditions = [
    eq(sourceRecords.source, input.source),
    eq(sourceRecords.isActive, true),
    notInArray(sourceRecords.sourceRecordId, input.seenSourceRecordIds),
  ];
  const opportunityConditions = [
    eq(opportunities.source, input.source),
    eq(opportunities.isActive, true),
    notInArray(opportunities.sourceOpportunityId, input.seenSourceRecordIds),
  ];

  if (input.agency) {
    sourceRecordConditions.push(eq(sourceRecords.sourceAgency, input.agency));
    opportunityConditions.push(eq(opportunities.agencySlug, input.agency));
  }

  await db
    .update(sourceRecords)
    .set({ isActive: false, updatedAt: now })
    .where(and(...sourceRecordConditions));
  await db
    .update(opportunities)
    .set({ isActive: false, updatedAt: now })
    .where(and(...opportunityConditions));
}

export async function finishIngestionRun(input: {
  runId: string;
  status: Exclude<IngestionStatus, "running">;
  reportedTotal: number | null;
  pagesFetched: number;
  recordsSeen: number;
  checkpoint: Record<string, unknown>;
  paginationComplete: boolean;
  normalizationComplete: boolean;
  error?: string;
}) {
  const db = getDb();
  await db
    .update(ingestionRuns)
    .set({
      status: input.status,
      completedAt: new Date(),
      reportedTotal: input.reportedTotal,
      pagesFetched: input.pagesFetched,
      recordsSeen: input.recordsSeen,
      checkpoint: input.checkpoint,
      paginationComplete: input.paginationComplete,
      normalizationComplete: input.normalizationComplete,
      error: input.error,
      updatedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, input.runId));
}

export { closeDb };
