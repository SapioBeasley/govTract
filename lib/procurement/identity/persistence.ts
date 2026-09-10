import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { agencies, opportunitySourceRecords } from "@/lib/db/canonical-schema";
import {
  opportunities,
  opportunityDocuments,
  opportunityDocumentVersions,
  sourceRecords,
} from "@/lib/db/schema";
import {
  persistNormalizedOpportunity,
  type PersistableOpportunityRecord,
} from "@/lib/procurement/ingestion/persistence";
import {
  normalizeSolicitationIdentity,
  resolveOpportunityIdentity,
  type OpportunityIdentityCandidate,
  type OpportunityIdentityDecision,
  type OpportunityIdentityInput,
} from "./opportunity";

const CANDIDATE_DATE_WINDOW_MS = 36 * 60 * 60 * 1000;
const MAX_COMPOSITE_CANDIDATES = 250;

function normalizeLookupValue(value?: string | null) {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function documentFingerprints(record: PersistableOpportunityRecord) {
  return [
    ...new Set(
      (record.documents ?? [])
        .map((document) => document.checksumSha256?.trim().toLowerCase() ?? "")
        .filter((value) => /^[a-f0-9]{64}$/.test(value)),
    ),
  ];
}

function incomingIdentity(
  source: string,
  record: PersistableOpportunityRecord,
): OpportunityIdentityInput {
  return {
    source,
    sourceRecordId: record.sourceRecordId,
    agencyKey: record.agencySlug ?? record.agencyName ?? null,
    solicitationNumber: record.solicitationNumber ?? null,
    title: record.title,
    publishedAt: record.publishedAt ?? null,
    issueAt: record.issueAt ?? null,
    dueAt: record.dueAt ?? null,
    location: record.location ?? {},
    documentFingerprints: documentFingerprints(record),
  };
}

async function findExistingSourceLink(sourceRecordPk: string) {
  const db = getDb();
  const [link] = await db
    .select({
      opportunityId: opportunitySourceRecords.opportunityId,
      isPrimary: opportunitySourceRecords.isPrimary,
    })
    .from(opportunitySourceRecords)
    .where(eq(opportunitySourceRecords.sourceRecordId, sourceRecordPk))
    .limit(1);

  return link ?? null;
}

function dateRange(date: Date) {
  return {
    start: new Date(date.getTime() - CANDIDATE_DATE_WINDOW_MS),
    end: new Date(date.getTime() + CANDIDATE_DATE_WINDOW_MS),
  };
}

async function collectCandidateOpportunityIds(record: PersistableOpportunityRecord) {
  const db = getDb();
  const ids = new Set<string>();
  const agencyKey = record.agencySlug ?? record.agencyName ?? null;
  const normalizedAgency = normalizeLookupValue(agencyKey);
  const normalizedSolicitation = normalizeSolicitationIdentity(record.solicitationNumber);

  if (normalizedAgency && normalizedSolicitation) {
    const exactRows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          sql`regexp_replace(lower(coalesce(${opportunities.agencySlug}, ${opportunities.agencyName}, '')), '[^a-z0-9]', '', 'g') = ${normalizedAgency}`,
          sql`regexp_replace(lower(coalesce(${opportunities.solicitationNumber}, '')), '[^a-z0-9]', '', 'g') = ${normalizedSolicitation}`,
        ),
      )
      .limit(20);
    for (const row of exactRows) ids.add(row.id);
  }

  const fingerprints = documentFingerprints(record);
  if (fingerprints.length > 0) {
    const documentRows = await db
      .select({ opportunityId: opportunityDocuments.opportunityId })
      .from(opportunityDocumentVersions)
      .innerJoin(
        opportunityDocuments,
        eq(
          opportunityDocuments.id,
          opportunityDocumentVersions.opportunityDocumentId,
        ),
      )
      .where(inArray(opportunityDocumentVersions.checksumSha256, fingerprints));
    for (const row of documentRows) ids.add(row.opportunityId);
  }

  const compositeConditions = [];
  if (normalizedAgency) {
    compositeConditions.push(
      sql`regexp_replace(lower(coalesce(${opportunities.agencySlug}, ${opportunities.agencyName}, '')), '[^a-z0-9]', '', 'g') = ${normalizedAgency}`,
    );
  }
  for (const columnAndDate of [
    [opportunities.publishedAt, record.publishedAt],
    [opportunities.issueAt, record.issueAt],
    [opportunities.dueAt, record.dueAt],
  ] as const) {
    const [column, date] = columnAndDate;
    if (!date) continue;
    const range = dateRange(date);
    compositeConditions.push(and(gte(column, range.start), lte(column, range.end))!);
  }

  const compositeWhere = or(...compositeConditions);
  if (compositeWhere) {
    const compositeRows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(compositeWhere)
      .orderBy(desc(opportunities.updatedAt))
      .limit(MAX_COMPOSITE_CANDIDATES);
    for (const row of compositeRows) ids.add(row.id);
  }

  return [...ids];
}

async function loadIdentityCandidates(
  record: PersistableOpportunityRecord,
): Promise<OpportunityIdentityCandidate[]> {
  const db = getDb();
  const candidateIds = await collectCandidateOpportunityIds(record);
  if (candidateIds.length === 0) return [];

  const rows = await db
    .select({
      id: opportunities.id,
      source: opportunities.source,
      sourceOpportunityId: opportunities.sourceOpportunityId,
      agencySlug: opportunities.agencySlug,
      agencyName: opportunities.agencyName,
      solicitationNumber: opportunities.solicitationNumber,
      title: opportunities.title,
      publishedAt: opportunities.publishedAt,
      issueAt: opportunities.issueAt,
      dueAt: opportunities.dueAt,
      location: opportunities.location,
    })
    .from(opportunities)
    .where(inArray(opportunities.id, candidateIds));

  const sourceLinks = await db
    .select({
      opportunityId: opportunitySourceRecords.opportunityId,
      source: sourceRecords.source,
      sourceRecordId: sourceRecords.sourceRecordId,
    })
    .from(opportunitySourceRecords)
    .innerJoin(sourceRecords, eq(sourceRecords.id, opportunitySourceRecords.sourceRecordId))
    .where(inArray(opportunitySourceRecords.opportunityId, candidateIds));

  const checksumRows = await db
    .select({
      opportunityId: opportunityDocuments.opportunityId,
      checksum: opportunityDocumentVersions.checksumSha256,
    })
    .from(opportunityDocumentVersions)
    .innerJoin(
      opportunityDocuments,
      eq(opportunityDocuments.id, opportunityDocumentVersions.opportunityDocumentId),
    )
    .where(
      and(
        inArray(opportunityDocuments.opportunityId, candidateIds),
        isNotNull(opportunityDocumentVersions.checksumSha256),
      ),
    );

  const sourcesByOpportunity = new Map<string, Array<{ source: string; sourceRecordId: string }>>();
  for (const link of sourceLinks) {
    const values = sourcesByOpportunity.get(link.opportunityId) ?? [];
    values.push({ source: link.source, sourceRecordId: link.sourceRecordId });
    sourcesByOpportunity.set(link.opportunityId, values);
  }

  const fingerprintsByOpportunity = new Map<string, Set<string>>();
  for (const row of checksumRows) {
    if (!row.checksum) continue;
    const values = fingerprintsByOpportunity.get(row.opportunityId) ?? new Set<string>();
    values.add(row.checksum.toLowerCase());
    fingerprintsByOpportunity.set(row.opportunityId, values);
  }

  return rows.map((row) => ({
    opportunityId: row.id,
    sourceRecords:
      sourcesByOpportunity.get(row.id) ??
      [{ source: row.source, sourceRecordId: row.sourceOpportunityId }],
    agencyKey: row.agencySlug ?? row.agencyName ?? null,
    solicitationNumber: row.solicitationNumber,
    title: row.title,
    publishedAt: row.publishedAt,
    issueAt: row.issueAt,
    dueAt: row.dueAt,
    location: row.location,
    documentFingerprints: [...(fingerprintsByOpportunity.get(row.id) ?? new Set<string>())],
  }));
}

function sameSourceDecision(opportunityId: string): OpportunityIdentityDecision {
  return {
    kind: "match",
    opportunityId,
    method: "same_source_record",
    confidence: 100,
    evidence: { score: 100, signals: ["same_source_record"] },
  };
}

async function findAgencyId(record: PersistableOpportunityRecord) {
  if (!record.agencySlug) return null;
  const db = getDb();
  const [agency] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, record.agencySlug))
    .limit(1);
  return agency?.id ?? null;
}

async function attachSecondarySource(input: {
  opportunityId: string;
  source: string;
  sourceRecordPk: string;
  record: PersistableOpportunityRecord;
  resolution: Extract<OpportunityIdentityDecision, { kind: "match" }>;
}) {
  const db = getDb();
  const now = new Date();
  const agencyId = await findAgencyId(input.record);

  await db
    .insert(opportunitySourceRecords)
    .values({
      opportunityId: input.opportunityId,
      sourceRecordId: input.sourceRecordPk,
      agencyId,
      isPrimary: false,
      linkMethod: input.resolution.method,
      confidence: input.resolution.confidence,
      evidence: {
        source: input.source,
        sourceOpportunityId: input.record.sourceRecordId,
        identityResolution: input.resolution,
      },
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opportunitySourceRecords.sourceRecordId,
      set: {
        opportunityId: input.opportunityId,
        agencyId,
        isPrimary: false,
        linkMethod: input.resolution.method,
        confidence: input.resolution.confidence,
        evidence: {
          source: input.source,
          sourceOpportunityId: input.record.sourceRecordId,
          identityResolution: input.resolution,
        },
        lastSeenAt: now,
        updatedAt: now,
      },
    });
}

async function persistNewCanonical(input: {
  source: string;
  sourceRecordPk: string;
  record: PersistableOpportunityRecord;
  resolution: Exclude<OpportunityIdentityDecision, { kind: "match" }>;
}) {
  await persistNormalizedOpportunity({
    source: input.source,
    sourceRecordPk: input.sourceRecordPk,
    record: input.record,
  });

  const db = getDb();
  const [link] = await db
    .select({ opportunityId: opportunitySourceRecords.opportunityId })
    .from(opportunitySourceRecords)
    .where(eq(opportunitySourceRecords.sourceRecordId, input.sourceRecordPk))
    .limit(1);
  if (!link) {
    throw new Error(`Failed to resolve canonical opportunity for ${input.record.sourceRecordId}`);
  }

  await db
    .update(opportunitySourceRecords)
    .set({
      evidence: {
        source: input.source,
        sourceOpportunityId: input.record.sourceRecordId,
        identityResolution: input.resolution,
      },
      updatedAt: new Date(),
    })
    .where(eq(opportunitySourceRecords.sourceRecordId, input.sourceRecordPk));

  return link.opportunityId;
}

export async function persistIdentityResolvedOpportunity(input: {
  source: string;
  sourceRecordPk: string;
  record: PersistableOpportunityRecord;
}) {
  const db = getDb();
  const existingLink = await findExistingSourceLink(input.sourceRecordPk);
  if (existingLink) {
    const resolution = sameSourceDecision(existingLink.opportunityId);
    if (existingLink.isPrimary) {
      await persistNormalizedOpportunity(input);
    } else {
      await db
        .update(opportunitySourceRecords)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(opportunitySourceRecords.sourceRecordId, input.sourceRecordPk));
    }

    return {
      opportunityId: existingLink.opportunityId,
      identityResolution: resolution,
    };
  }

  const resolution = resolveOpportunityIdentity({
    incoming: incomingIdentity(input.source, input.record),
    candidates: await loadIdentityCandidates(input.record),
  });

  if (resolution.kind === "match") {
    await attachSecondarySource({
      opportunityId: resolution.opportunityId,
      source: input.source,
      sourceRecordPk: input.sourceRecordPk,
      record: input.record,
      resolution,
    });
    return {
      opportunityId: resolution.opportunityId,
      identityResolution: resolution,
    };
  }

  const opportunityId = await persistNewCanonical({
    source: input.source,
    sourceRecordPk: input.sourceRecordPk,
    record: input.record,
    resolution,
  });
  return {
    opportunityId,
    identityResolution: resolution,
  };
}
