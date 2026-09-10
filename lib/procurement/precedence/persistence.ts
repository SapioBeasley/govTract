import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunitySourceRecords } from "@/lib/db/canonical-schema";
import { opportunities, sourceRecords } from "@/lib/db/schema";
import { normalizeProcurementSourceAuthority } from "@/lib/procurement/sources/authority";
import {
  selectCanonicalOpportunityFields,
  serializeOpportunityPrecedenceFields,
  type CanonicalOpportunityFields,
  type CanonicalOpportunitySourceSnapshot,
} from "./opportunity";

function hasRecognizedSnapshotField(payload: Record<string, unknown>) {
  return [
    "solicitationNumber",
    "title",
    "description",
    "status",
    "sourceStatus",
    "opportunityType",
    "agencyName",
    "agencySlug",
    "departments",
    "categories",
    "publishedAt",
    "issueAt",
    "dueAt",
    "canonicalUrl",
    "location",
  ].some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

function asCanonicalFields(payload: Record<string, unknown>): CanonicalOpportunityFields {
  return payload as CanonicalOpportunityFields;
}

function selectedDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function recomputeCanonicalOpportunityFields(opportunityId: string) {
  const db = getDb();
  const [current] = await db
    .select({
      id: opportunities.id,
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
    })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  if (!current) throw new Error(`Opportunity ${opportunityId} does not exist`);

  const links = await db
    .select({
      sourceRecordPk: sourceRecords.id,
      source: sourceRecords.source,
      sourceRecordId: sourceRecords.sourceRecordId,
      sourceAuthority: opportunitySourceRecords.sourceAuthority,
      isPrimary: opportunitySourceRecords.isPrimary,
      normalizedPayload: opportunitySourceRecords.normalizedPayload,
    })
    .from(opportunitySourceRecords)
    .innerJoin(sourceRecords, eq(sourceRecords.id, opportunitySourceRecords.sourceRecordId))
    .where(eq(opportunitySourceRecords.opportunityId, opportunityId));

  if (links.length === 0) {
    throw new Error(`Opportunity ${opportunityId} has no source links`);
  }

  const currentFields = serializeOpportunityPrecedenceFields(current);
  const snapshots: CanonicalOpportunitySourceSnapshot[] = links.map((link) => ({
    source: link.source,
    sourceRecordId: link.sourceRecordId,
    sourceRecordPk: link.sourceRecordPk,
    authority: normalizeProcurementSourceAuthority(link.sourceAuthority),
    isPrimary: link.isPrimary,
    fields:
      hasRecognizedSnapshotField(link.normalizedPayload)
        ? asCanonicalFields(link.normalizedPayload)
        : link.isPrimary
          ? currentFields
          : {},
  }));

  const selected = selectCanonicalOpportunityFields(snapshots);
  const fields = selected.fields;
  const title = typeof fields.title === "string" && fields.title.trim() ? fields.title : current.title;

  await db
    .update(opportunities)
    .set({
      solicitationNumber: fields.solicitationNumber ?? null,
      title,
      description: fields.description ?? null,
      status: fields.status ?? null,
      sourceStatus: fields.sourceStatus ?? null,
      opportunityType: fields.opportunityType ?? null,
      agencyName: fields.agencyName ?? null,
      agencySlug: fields.agencySlug ?? null,
      departments: fields.departments ?? [],
      categories: fields.categories ?? [],
      publishedAt: selectedDate(fields.publishedAt),
      issueAt: selectedDate(fields.issueAt),
      dueAt: selectedDate(fields.dueAt),
      canonicalUrl: fields.canonicalUrl ?? null,
      location: fields.location ?? {},
      fieldProvenance: selected.provenance,
      updatedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId));

  return selected;
}
