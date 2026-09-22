import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { pursuitDocumentSnapshots } from "@/lib/db/pursuit-snapshots-schema";
import { opportunities } from "@/lib/db/schema";

export type PendingPursuitSnapshot = {
  snapshotId: string;
  bidWorkspaceId: string | null;
  status: string;
  updatedAt: number;
};

/** Workspaces and saved pursuits share one bounded, idempotent recovery queue. */
export function prioritizePursuitSnapshotWork<T extends PendingPursuitSnapshot>(
  rows: T[], limit: number,
): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Snapshot work limit must be positive");
  return rows.filter((row) => row.status === "incomplete" || row.status === "blocked")
    .sort((left,right) =>
      (left.status === "incomplete" ? 0 : 1) -
      (right.status === "incomplete" ? 0 : 1) ||
      right.updatedAt - left.updatedAt ||
      left.snapshotId.localeCompare(right.snapshotId))
    .slice(0,limit);
}

/**
 * Select actual incomplete/blocked snapshots regardless of which context owns
 * them. The old saved-only, oldest-first sweep repeatedly selected previously
 * completed pursuits and starved newly created bid workspaces.
 */
export async function listPursuitSnapshotWork(source: string, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Snapshot work selection limit must be 1–50");
  }
  const rows = await getDb().select({
    snapshotId:pursuitDocumentSnapshots.id,
    bidWorkspaceId:pursuitDocumentSnapshots.bidWorkspaceId,
    status:pursuitDocumentSnapshots.status,
    updatedAt:pursuitDocumentSnapshots.updatedAt,
  }).from(pursuitDocumentSnapshots)
    .innerJoin(opportunities,eq(opportunities.id,pursuitDocumentSnapshots.opportunityId))
    .where(and(eq(opportunities.source,source),inArray(pursuitDocumentSnapshots.status,["incomplete","blocked"])))
    .orderBy(desc(pursuitDocumentSnapshots.updatedAt))
    .limit(Math.min(250,limit * 5));
  const ids = new Set<string>();
  return prioritizePursuitSnapshotWork(rows
    .map((row)=>({...row,updatedAt:row.updatedAt.getTime()}))
    .filter((row)=>!ids.has(row.snapshotId) && (ids.add(row.snapshotId),true)),limit);
}
