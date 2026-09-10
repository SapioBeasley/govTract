import type { ProcurementSourceAuthority } from "@/lib/procurement/sources/authority";

export const OPPORTUNITY_FIELD_PRECEDENCE_RULES = {
  version: 1,
  authority: {
    authoritative: 300,
    unknown: 200,
    aggregator: 100,
  },
  tieBreaker: "primary_then_source_identity",
  fields: {
    solicitationNumber: "highest_ranked_non_empty",
    title: "highest_ranked_non_empty",
    description: "highest_ranked_non_empty",
    status: "highest_ranked_non_empty",
    sourceStatus: "highest_ranked_non_empty",
    opportunityType: "highest_ranked_non_empty",
    agencyName: "highest_ranked_non_empty",
    agencySlug: "highest_ranked_non_empty",
    departments: "highest_ranked_non_empty",
    categories: "highest_ranked_non_empty",
    publishedAt: "highest_ranked_non_empty",
    issueAt: "highest_ranked_non_empty",
    dueAt: "highest_ranked_non_empty",
    canonicalUrl: "highest_ranked_non_empty",
    location: "highest_ranked_non_empty",
  },
} as const;

export type CanonicalOpportunityField = keyof typeof OPPORTUNITY_FIELD_PRECEDENCE_RULES.fields;

export interface CanonicalOpportunityFields {
  solicitationNumber?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  sourceStatus?: string | null;
  opportunityType?: string | null;
  agencyName?: string | null;
  agencySlug?: string | null;
  departments?: string[] | null;
  categories?: string[] | null;
  publishedAt?: string | null;
  issueAt?: string | null;
  dueAt?: string | null;
  canonicalUrl?: string | null;
  location?: Record<string, unknown> | null;
}

export interface CanonicalOpportunitySourceSnapshot {
  source: string;
  sourceRecordId: string;
  sourceRecordPk: string;
  authority: ProcurementSourceAuthority;
  isPrimary: boolean;
  fields: CanonicalOpportunityFields;
}

export interface CanonicalFieldConflict {
  source: string;
  sourceRecordId: string;
  sourceRecordPk: string;
  authority: ProcurementSourceAuthority;
  isPrimary: boolean;
  value: unknown;
}

export interface CanonicalFieldProvenance {
  source: string;
  sourceRecordId: string;
  sourceRecordPk: string;
  authority: ProcurementSourceAuthority;
  isPrimary: boolean;
  rule: "authority_then_primary_then_source_identity";
  conflicts?: CanonicalFieldConflict[];
}

export type CanonicalOpportunityFieldProvenance = Partial<
  Record<CanonicalOpportunityField, CanonicalFieldProvenance>
>;

const FIELD_NAMES = Object.keys(
  OPPORTUNITY_FIELD_PRECEDENCE_RULES.fields,
) as CanonicalOpportunityField[];

function authorityRank(authority: ProcurementSourceAuthority) {
  return OPPORTUNITY_FIELD_PRECEDENCE_RULES.authority[authority];
}

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
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

function stableValue(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function sourceIdentity(snapshot: CanonicalOpportunitySourceSnapshot) {
  return [snapshot.source, snapshot.sourceRecordId, snapshot.sourceRecordPk]
    .map((value) => value.trim().toLowerCase())
    .join("\u0000");
}

function compareSnapshots(
  left: CanonicalOpportunitySourceSnapshot,
  right: CanonicalOpportunitySourceSnapshot,
) {
  const rankDelta = authorityRank(right.authority) - authorityRank(left.authority);
  if (rankDelta !== 0) return rankDelta;
  if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
  return sourceIdentity(left).localeCompare(sourceIdentity(right));
}

export function selectCanonicalOpportunityFields(
  snapshots: readonly CanonicalOpportunitySourceSnapshot[],
): {
  fields: CanonicalOpportunityFields;
  provenance: CanonicalOpportunityFieldProvenance;
} {
  const fields: CanonicalOpportunityFields = {};
  const provenance: CanonicalOpportunityFieldProvenance = {};

  for (const field of FIELD_NAMES) {
    const ranked = snapshots
      .filter((snapshot) => isMeaningful(snapshot.fields[field]))
      .sort(compareSnapshots);
    const winner = ranked[0];
    if (!winner) continue;

    const value = winner.fields[field];
    (fields as Record<string, unknown>)[field] = value;

    const winnerValue = stableValue(value);
    const conflicts = ranked
      .slice(1)
      .filter((snapshot) => stableValue(snapshot.fields[field]) !== winnerValue)
      .map((snapshot) => ({
        source: snapshot.source,
        sourceRecordId: snapshot.sourceRecordId,
        sourceRecordPk: snapshot.sourceRecordPk,
        authority: snapshot.authority,
        isPrimary: snapshot.isPrimary,
        value: snapshot.fields[field],
      }));

    provenance[field] = {
      source: winner.source,
      sourceRecordId: winner.sourceRecordId,
      sourceRecordPk: winner.sourceRecordPk,
      authority: winner.authority,
      isPrimary: winner.isPrimary,
      rule: "authority_then_primary_then_source_identity",
      ...(conflicts.length > 0 ? { conflicts } : {}),
    };
  }

  return { fields, provenance };
}

export function serializeOpportunityPrecedenceFields(record: {
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
  publishedAt?: Date | null;
  issueAt?: Date | null;
  dueAt?: Date | null;
  canonicalUrl?: string | null;
  location?: Record<string, unknown> | null;
}): CanonicalOpportunityFields {
  return {
    solicitationNumber: record.solicitationNumber ?? null,
    title: record.title,
    description: record.description ?? null,
    status: record.status ?? null,
    sourceStatus: record.sourceStatus ?? null,
    opportunityType: record.opportunityType ?? null,
    agencyName: record.agencyName ?? null,
    agencySlug: record.agencySlug ?? null,
    departments: [...record.departments],
    categories: [...record.categories],
    publishedAt: record.publishedAt?.toISOString() ?? null,
    issueAt: record.issueAt?.toISOString() ?? null,
    dueAt: record.dueAt?.toISOString() ?? null,
    canonicalUrl: record.canonicalUrl ?? null,
    location: record.location ?? {},
  };
}
