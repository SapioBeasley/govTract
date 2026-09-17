import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  historicalProcurementClassifications,
  historicalProcurementIdentifiers,
  historicalProcurementOpportunityRelationships,
  historicalProcurementRecords,
  historicalProcurementRelationships,
  historicalProcurementSourceRecords,
} from "@/lib/db/historical-procurement-schema";
import {
  hashPayload,
  persistSourceRecord,
  recordIngestionRecordError,
  type SourceRecordChange,
} from "@/lib/procurement/ingestion/persistence";
import type {
  HistoricalProcurementSourceAdapter,
  HistoricalProcurementSourceContext,
  NormalizedHistoricalProcurementRecord,
} from "./adapter";

export class HistoricalProcurementProcessingError extends Error {
  readonly stage: string;
  readonly sourceRecordId: string | null;

  constructor(input: {
    stage: string;
    sourceRecordId?: string | null;
    cause: unknown;
  }) {
    const message = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(message, { cause: input.cause });
    this.name = "HistoricalProcurementProcessingError";
    this.stage = input.stage;
    this.sourceRecordId = input.sourceRecordId ?? null;
  }
}

export interface PersistedHistoricalProcurementRecord {
  sourceFactKey: string;
  historicalProcurementRecordId: string;
  change: SourceRecordChange;
}

export interface PersistedHistoricalProcurementSourceRecord {
  sourceRecordPk: string;
  change: SourceRecordChange;
  records: PersistedHistoricalProcurementRecord[];
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, jsonSafe(nested)]),
  );
}

function serializeNormalizedRecord(record: NormalizedHistoricalProcurementRecord) {
  return jsonSafe(record) as Record<string, unknown>;
}

function sourceEvidence(
  record: NormalizedHistoricalProcurementRecord,
  context: HistoricalProcurementSourceContext,
) {
  const evidence: Record<string, unknown> = {
    ...(record.evidence ?? {}),
  };

  if (context.sourceFile?.metadata) {
    evidence.sourceFileMetadata = context.sourceFile.metadata;
  }

  return evidence;
}

function canonicalValues(record: NormalizedHistoricalProcurementRecord, now: Date) {
  return {
    recordType: record.recordType,
    agencyId: record.buyer?.normalizedId ?? null,
    vendorId: record.vendor?.normalizedId ?? null,
    title: record.title ?? null,
    description: record.description ?? null,
    occurredAt: record.occurredAt ?? null,
    fiscalYear: record.fiscalYear ?? null,
    monetaryType: record.monetary?.type ?? null,
    amount: record.monetary?.amount ?? null,
    currency: record.monetary?.currency ?? "USD",
    buyerName: record.buyer?.name ?? null,
    buyerUnitName: record.buyer?.unitName ?? null,
    buyerSourceId: record.buyer?.sourceNativeId ?? null,
    vendorName: record.vendor?.name ?? null,
    vendorSourceId: record.vendor?.sourceNativeId ?? null,
    metadata: record.metadata ?? {},
    updatedAt: now,
  };
}

async function replaceIdentifiers(input: {
  historicalProcurementRecordId: string;
  sourceRecordPk: string;
  record: NormalizedHistoricalProcurementRecord;
}) {
  const db = getDb();
  await db
    .delete(historicalProcurementIdentifiers)
    .where(
      and(
        eq(
          historicalProcurementIdentifiers.historicalProcurementRecordId,
          input.historicalProcurementRecordId,
        ),
        eq(historicalProcurementIdentifiers.sourceRecordId, input.sourceRecordPk),
      ),
    );

  const identifiers = input.record.identifiers ?? [];
  if (identifiers.length === 0) return;

  await db.insert(historicalProcurementIdentifiers).values(
    identifiers.map((identifier) => ({
      historicalProcurementRecordId: input.historicalProcurementRecordId,
      sourceRecordId: input.sourceRecordPk,
      identifierType: identifier.type,
      identifierValue: identifier.value,
      sourceProvided: true,
      evidence: identifier.evidence ?? {},
    })),
  );
}

async function replaceClassifications(input: {
  historicalProcurementRecordId: string;
  sourceRecordPk: string;
  record: NormalizedHistoricalProcurementRecord;
  now: Date;
}) {
  const db = getDb();
  await db
    .delete(historicalProcurementClassifications)
    .where(
      and(
        eq(
          historicalProcurementClassifications.historicalProcurementRecordId,
          input.historicalProcurementRecordId,
        ),
        eq(historicalProcurementClassifications.sourceRecordId, input.sourceRecordPk),
      ),
    );

  const classifications = input.record.classifications ?? [];
  if (classifications.length === 0) return;

  await db.insert(historicalProcurementClassifications).values(
    classifications.map((classification) => ({
      historicalProcurementRecordId: input.historicalProcurementRecordId,
      sourceRecordId: input.sourceRecordPk,
      sourceClassificationKey: classification.sourceClassificationKey,
      scheme: classification.scheme,
      code: classification.code ?? null,
      name: classification.name ?? null,
      method: classification.method,
      confidence: classification.confidence ?? null,
      evidence: classification.evidence ?? {},
      updatedAt: input.now,
    })),
  );
}

async function persistNormalizedHistoricalRecord(input: {
  sourceRecordPk: string;
  record: NormalizedHistoricalProcurementRecord;
  context: HistoricalProcurementSourceContext;
}): Promise<PersistedHistoricalProcurementRecord> {
  const db = getDb();
  const now = new Date();
  const normalizedPayload = serializeNormalizedRecord(input.record);
  const evidence = sourceEvidence(input.record, input.context);
  const sourceFileId = input.context.sourceFile?.id ?? null;
  const sourceFileRevision = input.context.sourceFile?.revision ?? null;
  const sourcePublishedAt = input.context.sourceFile?.publishedAt ?? null;
  const nextFingerprint = hashPayload({
    normalizedPayload,
    evidence,
    sourceFileId,
    sourceFileRevision,
    sourcePublishedAt,
  });

  const [existing] = await db
    .select({
      historicalProcurementRecordId:
        historicalProcurementSourceRecords.historicalProcurementRecordId,
      normalizedPayload: historicalProcurementSourceRecords.normalizedPayload,
      evidence: historicalProcurementSourceRecords.evidence,
      sourceFileId: historicalProcurementSourceRecords.sourceFileId,
      sourceFileRevision: historicalProcurementSourceRecords.sourceFileRevision,
      sourcePublishedAt: historicalProcurementSourceRecords.sourcePublishedAt,
    })
    .from(historicalProcurementSourceRecords)
    .where(
      and(
        eq(historicalProcurementSourceRecords.sourceRecordId, input.sourceRecordPk),
        eq(historicalProcurementSourceRecords.sourceFactKey, input.record.sourceFactKey),
      ),
    )
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(historicalProcurementRecords)
      .values({
        ...canonicalValues(input.record, now),
        createdAt: now,
      })
      .returning({ id: historicalProcurementRecords.id });

    if (!created) {
      throw new Error(`Failed to create historical procurement fact ${input.record.sourceFactKey}`);
    }

    await db.insert(historicalProcurementSourceRecords).values({
      historicalProcurementRecordId: created.id,
      sourceRecordId: input.sourceRecordPk,
      sourceFactKey: input.record.sourceFactKey,
      sourceFileId,
      sourceFileRevision,
      sourcePublishedAt,
      normalizedPayload,
      evidence,
      createdAt: now,
      updatedAt: now,
    });

    await replaceIdentifiers({
      historicalProcurementRecordId: created.id,
      sourceRecordPk: input.sourceRecordPk,
      record: input.record,
    });
    await replaceClassifications({
      historicalProcurementRecordId: created.id,
      sourceRecordPk: input.sourceRecordPk,
      record: input.record,
      now,
    });

    return {
      sourceFactKey: input.record.sourceFactKey,
      historicalProcurementRecordId: created.id,
      change: "inserted",
    };
  }

  const existingFingerprint = hashPayload({
    normalizedPayload: existing.normalizedPayload,
    evidence: existing.evidence,
    sourceFileId: existing.sourceFileId,
    sourceFileRevision: existing.sourceFileRevision,
    sourcePublishedAt: existing.sourcePublishedAt,
  });

  if (existingFingerprint === nextFingerprint) {
    return {
      sourceFactKey: input.record.sourceFactKey,
      historicalProcurementRecordId: existing.historicalProcurementRecordId,
      change: "unchanged",
    };
  }

  await db
    .update(historicalProcurementRecords)
    .set(canonicalValues(input.record, now))
    .where(eq(historicalProcurementRecords.id, existing.historicalProcurementRecordId));

  await db
    .update(historicalProcurementSourceRecords)
    .set({
      sourceFileId,
      sourceFileRevision,
      sourcePublishedAt,
      normalizedPayload,
      evidence,
      updatedAt: now,
    })
    .where(
      and(
        eq(historicalProcurementSourceRecords.sourceRecordId, input.sourceRecordPk),
        eq(historicalProcurementSourceRecords.sourceFactKey, input.record.sourceFactKey),
      ),
    );

  await replaceIdentifiers({
    historicalProcurementRecordId: existing.historicalProcurementRecordId,
    sourceRecordPk: input.sourceRecordPk,
    record: input.record,
  });
  await replaceClassifications({
    historicalProcurementRecordId: existing.historicalProcurementRecordId,
    sourceRecordPk: input.sourceRecordPk,
    record: input.record,
    now,
  });

  return {
    sourceFactKey: input.record.sourceFactKey,
    historicalProcurementRecordId: existing.historicalProcurementRecordId,
    change: "updated",
  };
}

function summarizeChange(
  sourceChange: SourceRecordChange,
  records: readonly PersistedHistoricalProcurementRecord[],
): SourceRecordChange {
  if (sourceChange === "inserted" || records.some((record) => record.change === "inserted")) {
    return "inserted";
  }
  if (sourceChange === "updated" || records.some((record) => record.change === "updated")) {
    return "updated";
  }
  return "unchanged";
}

export async function persistHistoricalProcurementSourceRecord<
  TRawRecord extends Record<string, unknown>,
>(input: {
  adapter: HistoricalProcurementSourceAdapter<TRawRecord>;
  runId: string;
  record: TRawRecord;
  context: HistoricalProcurementSourceContext;
}): Promise<PersistedHistoricalProcurementSourceRecord> {
  let identity;
  try {
    identity = input.adapter.identify(input.record);
  } catch (error) {
    throw new HistoricalProcurementProcessingError({
      stage: "historical_identify",
      cause: error,
    });
  }

  let sourceRecord;
  try {
    sourceRecord = input.adapter.toSourceRecord(input.record, input.context);
  } catch (error) {
    throw new HistoricalProcurementProcessingError({
      stage: "historical_source_prepare",
      sourceRecordId: identity.sourceRecordId,
      cause: error,
    });
  }

  let persistedSource;
  try {
    persistedSource = await persistSourceRecord({
      runId: input.runId,
      source: input.adapter.source,
      agency: sourceRecord.sourceAgency ?? input.context.agency,
      record: {
        ...sourceRecord,
        sourceRecordId: identity.sourceRecordId,
        sourceRevisionId: identity.sourceRevisionId ?? sourceRecord.sourceRevisionId,
      },
    });
  } catch (error) {
    throw new HistoricalProcurementProcessingError({
      stage: "historical_source_persist",
      sourceRecordId: identity.sourceRecordId,
      cause: error,
    });
  }

  let normalizedRecords: readonly NormalizedHistoricalProcurementRecord[];
  try {
    normalizedRecords = input.adapter.normalize(input.record, input.context);
  } catch (error) {
    throw new HistoricalProcurementProcessingError({
      stage: "historical_normalize",
      sourceRecordId: identity.sourceRecordId,
      cause: error,
    });
  }

  const factKeys = new Set<string>();
  for (const normalizedRecord of normalizedRecords) {
    if (factKeys.has(normalizedRecord.sourceFactKey)) {
      throw new HistoricalProcurementProcessingError({
        stage: "historical_normalize",
        sourceRecordId: identity.sourceRecordId,
        cause: new Error(`Duplicate historical source fact key ${normalizedRecord.sourceFactKey}`),
      });
    }
    factKeys.add(normalizedRecord.sourceFactKey);
  }

  const records: PersistedHistoricalProcurementRecord[] = [];
  try {
    for (const normalizedRecord of normalizedRecords) {
      records.push(
        await persistNormalizedHistoricalRecord({
          sourceRecordPk: persistedSource.sourceRecordPk,
          record: normalizedRecord,
          context: input.context,
        }),
      );
    }
  } catch (error) {
    if (error instanceof HistoricalProcurementProcessingError) throw error;
    throw new HistoricalProcurementProcessingError({
      stage: "historical_persist",
      sourceRecordId: identity.sourceRecordId,
      cause: error,
    });
  }

  return {
    sourceRecordPk: persistedSource.sourceRecordPk,
    change: summarizeChange(persistedSource.change, records),
    records,
  };
}

export async function persistHistoricalProcurementBatch<
  TRawRecord extends Record<string, unknown>,
>(input: {
  adapter: HistoricalProcurementSourceAdapter<TRawRecord>;
  runId: string;
  records: readonly TRawRecord[];
  context: HistoricalProcurementSourceContext;
}) {
  const counts = {
    processed: input.records.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
  };

  for (const record of input.records) {
    try {
      const result = await persistHistoricalProcurementSourceRecord({
        adapter: input.adapter,
        runId: input.runId,
        record,
        context: input.context,
      });
      counts[result.change] += 1;
    } catch (error) {
      counts.errors += 1;
      let sourceRecordId: string | null = null;
      let stage = "historical_process";

      if (error instanceof HistoricalProcurementProcessingError) {
        sourceRecordId = error.sourceRecordId;
        stage = error.stage;
      } else {
        try {
          sourceRecordId = input.adapter.identify(record).sourceRecordId;
        } catch {
          sourceRecordId = null;
        }
      }

      await recordIngestionRecordError({
        runId: input.runId,
        pageNumber: 1,
        sourceRecordId,
        stage,
        error: error instanceof Error ? error.message : String(error),
        rawPayload: record,
      });
    }
  }

  return counts;
}

export async function upsertHistoricalProcurementRelationship(input: {
  fromHistoricalProcurementRecordId: string;
  toHistoricalProcurementRecordId: string;
  relationshipType: string;
  method: string;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
}) {
  const db = getDb();
  const now = new Date();
  const [relationship] = await db
    .insert(historicalProcurementRelationships)
    .values({
      fromHistoricalProcurementRecordId: input.fromHistoricalProcurementRecordId,
      toHistoricalProcurementRecordId: input.toHistoricalProcurementRecordId,
      relationshipType: input.relationshipType,
      method: input.method,
      confidence: input.confidence ?? null,
      evidence: input.evidence ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        historicalProcurementRelationships.fromHistoricalProcurementRecordId,
        historicalProcurementRelationships.toHistoricalProcurementRecordId,
        historicalProcurementRelationships.relationshipType,
      ],
      set: {
        method: input.method,
        confidence: input.confidence ?? null,
        evidence: input.evidence ?? {},
        updatedAt: now,
      },
    })
    .returning({ id: historicalProcurementRelationships.id });

  return relationship?.id ?? null;
}

export async function upsertHistoricalProcurementOpportunityRelationship(input: {
  historicalProcurementRecordId: string;
  opportunityId: string;
  relationshipType: string;
  method: string;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
}) {
  const db = getDb();
  const now = new Date();
  const [relationship] = await db
    .insert(historicalProcurementOpportunityRelationships)
    .values({
      historicalProcurementRecordId: input.historicalProcurementRecordId,
      opportunityId: input.opportunityId,
      relationshipType: input.relationshipType,
      method: input.method,
      confidence: input.confidence ?? null,
      evidence: input.evidence ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        historicalProcurementOpportunityRelationships.historicalProcurementRecordId,
        historicalProcurementOpportunityRelationships.opportunityId,
        historicalProcurementOpportunityRelationships.relationshipType,
      ],
      set: {
        method: input.method,
        confidence: input.confidence ?? null,
        evidence: input.evidence ?? {},
        updatedAt: now,
      },
    })
    .returning({ id: historicalProcurementOpportunityRelationships.id });

  return relationship?.id ?? null;
}
