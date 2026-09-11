import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunitySourceRecords } from "@/lib/db/canonical-schema";
import { opportunities, sourceRecords } from "@/lib/db/schema";
import {
  isOpportunityLifecycleActive,
  selectCanonicalOpportunityLifecycle,
  type CanonicalOpportunityLifecycleResult,
} from "@/lib/procurement/lifecycle/opportunity";
import { normalizeProcurementSourceAuthority } from "@/lib/procurement/sources/authority";

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function recomputeCanonicalOpportunityLifecycle(
  opportunityId: string,
): Promise<CanonicalOpportunityLifecycleResult> {
  const db = getDb();
  const rows = await db
    .select({
      source: sourceRecords.source,
      sourceRecordId: sourceRecords.sourceRecordId,
      sourceRecordActive: sourceRecords.isActive,
      sourceAuthority: opportunitySourceRecords.sourceAuthority,
      isPrimary: opportunitySourceRecords.isPrimary,
      normalizedPayload: opportunitySourceRecords.normalizedPayload,
    })
    .from(opportunitySourceRecords)
    .innerJoin(sourceRecords, eq(sourceRecords.id, opportunitySourceRecords.sourceRecordId))
    .where(eq(opportunitySourceRecords.opportunityId, opportunityId));

  const lifecycle = selectCanonicalOpportunityLifecycle(
    rows.map((row) => ({
      source: row.source,
      sourceRecordId: row.sourceRecordId,
      sourceRecordActive: row.sourceRecordActive,
      authority: normalizeProcurementSourceAuthority(row.sourceAuthority),
      isPrimary: row.isPrimary,
      status: optionalString(row.normalizedPayload.status),
      sourceStatus: optionalString(row.normalizedPayload.sourceStatus),
    })),
  );

  await db
    .update(opportunities)
    .set({
      lifecycleState: lifecycle.state,
      isActive: isOpportunityLifecycleActive(lifecycle.state),
      updatedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId));

  return lifecycle;
}

export async function recomputeCanonicalOpportunityLifecycles(opportunityIds: string[]) {
  const uniqueIds = [...new Set(opportunityIds.filter(Boolean))];
  const results = new Map<string, CanonicalOpportunityLifecycleResult>();

  for (const opportunityId of uniqueIds) {
    results.set(
      opportunityId,
      await recomputeCanonicalOpportunityLifecycle(opportunityId),
    );
  }

  return results;
}

export async function findOpportunityIdsForSourceRecords(sourceRecordIds: string[]) {
  const uniqueIds = [...new Set(sourceRecordIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({ opportunityId: opportunitySourceRecords.opportunityId })
    .from(opportunitySourceRecords)
    .where(inArray(opportunitySourceRecords.sourceRecordId, uniqueIds));

  return [...new Set(rows.map((row) => row.opportunityId))];
}
