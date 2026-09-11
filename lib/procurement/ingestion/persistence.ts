import { createHash } from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { agencies, opportunitySourceRecords } from "@/lib/db/canonical-schema";
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
import {
  findOpportunityIdsForSourceRecords,
  recomputeCanonicalOpportunityLifecycle,
  recomputeCanonicalOpportunityLifecycles,
} from "@/lib/procurement/lifecycle/persistence";
import {
  deriveSourceOpportunityLifecycle,
  isOpportunityLifecycleActive,
} from "@/lib/procurement/lifecycle/opportunity";
import { recomputeCanonicalOpportunityFields } from "@/lib/procurement/precedence/persistence";
import { serializeOpportunityPrecedenceFields } from "@/lib/procurement/precedence/opportunity";
import type { ProcurementSourceAuthority } from "@/lib/procurement/sources/authority";

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

async function upsertCanonicalAgency(input: {
  agencySlug?: string | null;
  agencyName?: string | null;
  updatedAt: Date;
}) {
  if (!input.agencySlug) return null;

  const db = getDb();
  const [agency] = await db
    .insert(agencies)
    .values({
      slug: input.agencySlug,
      canonicalName: input.agencyName ?? input.agencySlug,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: agencies.slug,
      set: {
        canonicalName: input.agencyName ?? input.agencySlug,
        updatedAt: input.updatedAt,
      },
    })
    .returning({ id: agencies.id });

  return agency?.id ?? null;
}

export async function persistNormalizedOpportunity(input: {
  source: string;
  sourceRecordPk: string;
  record: PersistableOpportunityRecord;
  sourceAuthority?: ProcurementSourceAuthority;
}) {
  const db = getDb();
  const now = new Date();
  const sourceAuthority = input.sourceAuthority ?? "unknown";
  const normalizedPayload = serializeOpportunityPrecedenceFields(input.record);
  const initialLifecycle = deriveSourceOpportunityLifecycle({
    sourceRecordActive: true,
    status: input.record.status,
    sourceStatus: input.record.sourceStatus,
  });
  const agencyId = await upsertCanonicalAgency({
    agencySlug: input.record.agencySlug,
    agencyName: input.record.agencyName,
    updatedAt: now,
  });

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
      lifecycleState: initialLifecycle.state,
      isActive: isOpportunityLifecycleActive(initialLifecycle.state),
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [opportunities.source, opportunities.sourceOpportunityId],
      set: {
        sourceRecordId: input.sourceRecordPk,
        sourceRevisionId: input.record.sourceRevisionId,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: opportunities.id });

  if (!opportunity) throw new Error(`Failed to upsert opportunity ${input.record.sourceRecordId}`);

  await db
    .insert(opportunitySourceRecords)
    .values({
      opportunityId: opportunity.id,
      sourceRecordId: input.sourceRecordPk,
      agencyId,
      isPrimary: true,
      linkMethod: "direct",
      confidence: 100,
      sourceAuthority,
      normalizedPayload,
      evidence: {
        source: input.source,
        sourceOpportunityId: input.record.sourceRecordId,
      },
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opportunitySourceRecords.sourceRecordId,
      set: {
        opportunityId: opportunity.id,
        agencyId,
        isPrimary: true,
        linkMethod: "direct",
        confidence: 100,
        sourceAuthority,
        normalizedPayload,
        evidence: {
          source: input.source,
          sourceOpportunityId: input.record.sourceRecordId,
        },
        lastSeenAt: now,
        updatedAt: now,
      },
    });

  await recomputeCanonicalOpportunityFields(opportunity.id);
  await recomputeCanonicalOpportunityLifecycle(opportunity.id);

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
  pageNumber?: number;
  counts: PagePersistenceCounts;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    let pageNumber = input.pageNumber;
    if (pageNumber === undefined) {
      const [run] = await tx
        .select({ pageNumber: ingestionRuns.pagesFetched })
        .from(ingestionRuns)
        .where(eq(ingestionRuns.id, input.runId))
        .limit(1);
      pageNumber = run?.pageNumber;
    }

    if (!pageNumber || pageNumber < 1) {
      throw new Error(`Cannot record persistence counts before a page is persisted for run ${input.runId}`);
    }

    await tx
      .update(ingestionRunPages)
      .set({
        insertedCount: input.counts.inserted,
        updatedCount: input.counts.updated,
        unchangedCount: input.counts.unchanged,
      })
      .where(
        and(
          eq(ingestionRunPages.ingestionRunId, input.runId),
          eq(ingestionRunPages.pageNumber, pageNumber),
        ),
      );

    const [totals] = await tx
      .select({
        inserted: sql<number>`coalesce(sum(${ingestionRunPages.insertedCount}), 0)::int`,
        updated: sql<number>`coalesce(sum(${ingestionRunPages.updatedCount}), 0)::int`,
        unchanged: sql<number>`coalesce(sum(${ingestionRunPages.unchangedCount}), 0)::int`,
      })
      .from(ingestionRunPages)
      .where(eq(ingestionRunPages.ingestionRunId, input.runId));

    await tx
      .update(ingestionRuns)
      .set({
        insertedCount: totals?.inserted ?? 0,
        updatedCount: totals?.updated ?? 0,
        unchangedCount: totals?.unchanged ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(ingestionRuns.id, input.runId));
  });
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

  if (input.agency) {
    sourceRecordConditions.push(eq(sourceRecords.sourceAgency, input.agency));
  }

  const archivedSourceRecords = await db
    .update(sourceRecords)
    .set({ isActive: false, updatedAt: now })
    .where(and(...sourceRecordConditions))
    .returning({ id: sourceRecords.id });

  const opportunityIds = await findOpportunityIdsForSourceRecords(
    archivedSourceRecords.map((row) => row.id),
  );
  await recomputeCanonicalOpportunityLifecycles(opportunityIds);
}

export async function reconcileIngestionScope(input: {
  source: string;
  agency?: string;
  seenSourceRecordIds: string[];
  status: Exclude<IngestionStatus, "running">;
  reportedTotal: number | null;
  paginationComplete: boolean;
  normalizationComplete: boolean;
}) {
  const safeToReconcile =
    input.status === "complete" &&
    input.paginationComplete &&
    input.normalizationComplete &&
    input.reportedTotal !== null &&
    input.reportedTotal > 0 &&
    input.seenSourceRecordIds.length > 0;

  if (!safeToReconcile) return false;

  await reconcileCompleteScope({
    source: input.source,
    agency: input.agency,
    seenSourceRecordIds: input.seenSourceRecordIds,
  });
  return true;
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
