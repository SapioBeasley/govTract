import { createHash } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import {
  ingestionRunPages,
  ingestionRuns,
  opportunities,
  opportunityDocuments,
  sourceRecords,
} from "@/lib/db/schema";

export type IngestionStatus = "running" | "complete" | "partial" | "failed";

export interface PersistableDocument {
  sourceDocumentKey: string;
  sourceDocumentId?: string | null;
  name: string;
  url?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  sourceMetadata: Record<string, unknown>;
}

export interface PersistableOpportunityRecord {
  sourceRecordId: string;
  sourceRevisionId?: string | null;
  sourceModifiedAt?: Date | null;
  canonicalUrl?: string | null;
  rawPayload: Record<string, unknown>;
  solicitationNumber?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  opportunityType?: string | null;
  agencyName?: string | null;
  agencySlug?: string | null;
  departments: string[];
  categories: string[];
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

export async function persistIngestionPage(input: {
  runId: string;
  source: string;
  agency?: string;
  pageNumber: number;
  cursor: Record<string, unknown>;
  reportedTotal: number;
  rawPayload: Record<string, unknown>;
  records: PersistableOpportunityRecord[];
}): Promise<PagePersistenceCounts> {
  const db = getDb();
  const now = new Date();
  const pageHash = hashPayload(input.rawPayload);

  // Preserve the original source page before any normalization happens.
  await db
    .insert(ingestionRunPages)
    .values({
      ingestionRunId: input.runId,
      pageNumber: input.pageNumber,
      cursor: input.cursor,
      reportedTotal: input.reportedTotal,
      recordCount: input.records.length,
      rawPayload: input.rawPayload,
      payloadHash: pageHash,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [ingestionRunPages.ingestionRunId, ingestionRunPages.pageNumber],
      set: {
        cursor: input.cursor,
        reportedTotal: input.reportedTotal,
        recordCount: input.records.length,
        rawPayload: input.rawPayload,
        payloadHash: pageHash,
        fetchedAt: now,
      },
    });

  const counts: PagePersistenceCounts = { inserted: 0, updated: 0, unchanged: 0 };

  for (const record of input.records) {
    const recordHash = hashPayload(record.rawPayload);
    const [existing] = await db
      .select({ id: sourceRecords.id, payloadHash: sourceRecords.payloadHash })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.source, input.source),
          eq(sourceRecords.sourceRecordId, record.sourceRecordId),
        ),
      )
      .limit(1);

    let sourceRecordPk: string;
    let changed = false;

    if (!existing) {
      const [created] = await db
        .insert(sourceRecords)
        .values({
          source: input.source,
          sourceRecordId: record.sourceRecordId,
          sourceRevisionId: record.sourceRevisionId,
          sourceModifiedAt: record.sourceModifiedAt,
          sourceAgency: input.agency,
          canonicalUrl: record.canonicalUrl,
          rawPayload: record.rawPayload,
          payloadHash: recordHash,
          firstSeenAt: now,
          lastSeenAt: now,
          lastIngestionRunId: input.runId,
          isActive: true,
          updatedAt: now,
        })
        .returning({ id: sourceRecords.id });

      if (!created) throw new Error(`Failed to insert source record ${record.sourceRecordId}`);
      sourceRecordPk = created.id;
      counts.inserted += 1;
      changed = true;
    } else if (existing.payloadHash !== recordHash) {
      sourceRecordPk = existing.id;
      await db
        .update(sourceRecords)
        .set({
          sourceRevisionId: record.sourceRevisionId,
          sourceModifiedAt: record.sourceModifiedAt,
          sourceAgency: input.agency,
          canonicalUrl: record.canonicalUrl,
          rawPayload: record.rawPayload,
          payloadHash: recordHash,
          lastSeenAt: now,
          lastIngestionRunId: input.runId,
          isActive: true,
          updatedAt: now,
        })
        .where(eq(sourceRecords.id, existing.id));
      counts.updated += 1;
      changed = true;
    } else {
      sourceRecordPk = existing.id;
      await db
        .update(sourceRecords)
        .set({
          lastSeenAt: now,
          lastIngestionRunId: input.runId,
          isActive: true,
        })
        .where(eq(sourceRecords.id, existing.id));
      counts.unchanged += 1;
    }

    if (!changed) {
      await db
        .update(opportunities)
        .set({ lastSeenAt: now, isActive: true })
        .where(
          and(
            eq(opportunities.source, input.source),
            eq(opportunities.sourceOpportunityId, record.sourceRecordId),
          ),
        );
      continue;
    }

    const [opportunity] = await db
      .insert(opportunities)
      .values({
        sourceRecordId: sourceRecordPk,
        source: input.source,
        sourceOpportunityId: record.sourceRecordId,
        sourceRevisionId: record.sourceRevisionId,
        solicitationNumber: record.solicitationNumber,
        title: record.title,
        description: record.description,
        status: record.status,
        opportunityType: record.opportunityType,
        agencyName: record.agencyName,
        agencySlug: record.agencySlug,
        departments: record.departments,
        categories: record.categories,
        publishedAt: record.publishedAt,
        issueAt: record.issueAt,
        dueAt: record.dueAt,
        canonicalUrl: record.canonicalUrl,
        location: record.location ?? {},
        isActive: true,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [opportunities.source, opportunities.sourceOpportunityId],
        set: {
          sourceRecordId: sourceRecordPk,
          sourceRevisionId: record.sourceRevisionId,
          solicitationNumber: record.solicitationNumber,
          title: record.title,
          description: record.description,
          status: record.status,
          opportunityType: record.opportunityType,
          agencyName: record.agencyName,
          agencySlug: record.agencySlug,
          departments: record.departments,
          categories: record.categories,
          publishedAt: record.publishedAt,
          issueAt: record.issueAt,
          dueAt: record.dueAt,
          canonicalUrl: record.canonicalUrl,
          location: record.location ?? {},
          isActive: true,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: opportunities.id });

    if (!opportunity) throw new Error(`Failed to upsert opportunity ${record.sourceRecordId}`);

    for (const document of record.documents ?? []) {
      await db
        .insert(opportunityDocuments)
        .values({
          opportunityId: opportunity.id,
          sourceDocumentKey: document.sourceDocumentKey,
          sourceDocumentId: document.sourceDocumentId,
          name: document.name,
          url: document.url,
          mimeType: document.mimeType,
          fileSizeBytes: document.fileSizeBytes,
          sourceMetadata: document.sourceMetadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            opportunityDocuments.opportunityId,
            opportunityDocuments.sourceDocumentKey,
          ],
          set: {
            sourceDocumentId: document.sourceDocumentId,
            name: document.name,
            url: document.url,
            mimeType: document.mimeType,
            fileSizeBytes: document.fileSizeBytes,
            sourceMetadata: document.sourceMetadata,
            updatedAt: now,
          },
        });
    }
  }

  await db
    .update(ingestionRuns)
    .set({
      checkpoint: input.cursor,
      reportedTotal: input.reportedTotal,
      pagesFetched: input.pageNumber,
      recordsSeen: sql`${ingestionRuns.recordsSeen} + ${input.records.length}`,
      insertedCount: sql`${ingestionRuns.insertedCount} + ${counts.inserted}`,
      updatedCount: sql`${ingestionRuns.updatedCount} + ${counts.updated}`,
      unchangedCount: sql`${ingestionRuns.unchangedCount} + ${counts.unchanged}`,
      updatedAt: now,
    })
    .where(eq(ingestionRuns.id, input.runId));

  return counts;
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
  checkpoint: Record<string, unknown>;
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
      checkpoint: input.checkpoint,
      error: input.error,
      updatedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, input.runId));
}

export { closeDb };
