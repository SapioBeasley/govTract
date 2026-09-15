import { and, asc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunitySourceRecords } from "@/lib/db/canonical-schema";
import { opportunities, sourceRecords } from "@/lib/db/schema";
import { recomputeCanonicalOpportunityLifecycle } from "@/lib/procurement/lifecycle/persistence";
import { recomputeCanonicalOpportunityFields } from "@/lib/procurement/precedence/persistence";
import type { BeaconRenderedLifecycleState } from "./lifecycle";

export interface BeaconLifecycleRefreshCandidate {
  opportunityId: string;
  sourceOpportunityId: string;
  canonicalUrl: string;
  lifecycleState: string;
  dueAt: Date | null;
}

export async function listBeaconLifecycleRefreshCandidates(input: {
  agencySlug?: string;
  now?: Date;
  limit?: number;
} = {}): Promise<BeaconLifecycleRefreshCandidate[]> {
  const db = getDb();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(250, Math.floor(input.limit ?? 50)));
  const agencySlug = input.agencySlug ?? "city-of-houston";

  return db
    .select({
      opportunityId: opportunities.id,
      sourceOpportunityId: opportunities.sourceOpportunityId,
      canonicalUrl: opportunities.canonicalUrl,
      lifecycleState: opportunities.lifecycleState,
      dueAt: opportunities.dueAt,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.source, "beacon"),
        eq(opportunities.agencySlug, agencySlug),
        isNotNull(opportunities.canonicalUrl),
        or(
          and(eq(opportunities.lifecycleState, "active"), lte(opportunities.dueAt, now)),
          inArray(opportunities.lifecycleState, ["inactive_unknown", "pending_award", "closed"]),
        ),
      ),
    )
    .orderBy(asc(opportunities.dueAt), asc(opportunities.id))
    .limit(limit)
    .then((rows) =>
      rows.flatMap((row) =>
        row.canonicalUrl
          ? [
              {
                opportunityId: row.opportunityId,
                sourceOpportunityId: row.sourceOpportunityId,
                canonicalUrl: row.canonicalUrl,
                lifecycleState: row.lifecycleState,
                dueAt: row.dueAt,
              },
            ]
          : [],
      ),
    );
}

export async function applyBeaconLifecycleObservation(input: {
  opportunityId: string;
  state: BeaconRenderedLifecycleState;
  sourceStatus: string;
  sourceUrl: string;
  evidenceText: string;
  observedAt?: Date;
}) {
  const db = getDb();
  const observedAt = input.observedAt ?? new Date();

  const [link] = await db
    .select({
      id: opportunitySourceRecords.id,
      normalizedPayload: opportunitySourceRecords.normalizedPayload,
      evidence: opportunitySourceRecords.evidence,
    })
    .from(opportunitySourceRecords)
    .innerJoin(sourceRecords, eq(sourceRecords.id, opportunitySourceRecords.sourceRecordId))
    .where(
      and(
        eq(opportunitySourceRecords.opportunityId, input.opportunityId),
        eq(sourceRecords.source, "beacon"),
      ),
    )
    .limit(1);

  if (!link) {
    throw new Error(`Opportunity ${input.opportunityId} has no linked Beacon source record`);
  }

  const lifecycleObservation = {
    state: input.state,
    sourceStatus: input.sourceStatus,
    sourceUrl: input.sourceUrl,
    evidenceText: input.evidenceText,
    observedAt: observedAt.toISOString(),
  };

  await db
    .update(opportunitySourceRecords)
    .set({
      normalizedPayload: {
        ...link.normalizedPayload,
        status: input.state.replaceAll("_", " "),
        sourceStatus: input.sourceStatus,
      },
      evidence: {
        ...link.evidence,
        lifecycleObservation,
      },
      updatedAt: observedAt,
    })
    .where(eq(opportunitySourceRecords.id, link.id));

  await recomputeCanonicalOpportunityFields(input.opportunityId);
  return recomputeCanonicalOpportunityLifecycle(input.opportunityId);
}
