import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { savedOpportunities } from "@/lib/db/saved-opportunities-schema";
import { opportunities } from "@/lib/db/schema";

export const SAVED_OPPORTUNITY_STATUSES = [
  "saved",
  "reviewing",
  "pursuing",
  "no_bid",
  "submitted",
  "won",
  "lost",
] as const;

export type SavedOpportunityStatus = (typeof SAVED_OPPORTUNITY_STATUSES)[number];
export type SavedOpportunitySnapshotStatus =
  | "not_required"
  | "incomplete"
  | "complete"
  | "blocked";

export type SavedOpportunityRecord = {
  id: string;
  opportunityId: string;
  title: string;
  agencyName: string | null;
  dueAt: Date | null;
  status: SavedOpportunityStatus;
  notes: string | null;
  priority: number;
  internalDeadline: Date | null;
  snapshotStatus: SavedOpportunitySnapshotStatus;
  savedAt: Date;
  updatedAt: Date;
};

export type UpdateSavedOpportunityInput = {
  status?: SavedOpportunityStatus;
  notes?: string | null;
  priority?: number;
  internalDeadline?: Date | null;
};

export function isSavedOpportunityStatus(value: unknown): value is SavedOpportunityStatus {
  return (
    typeof value === "string" &&
    (SAVED_OPPORTUNITY_STATUSES as readonly string[]).includes(value)
  );
}

function validatePriority(priority: number) {
  if (!Number.isInteger(priority) || priority < 0 || priority > 5) {
    throw new Error("Saved opportunity priority must be an integer from 0 through 5.");
  }
}

function selection() {
  return {
    id: savedOpportunities.id,
    opportunityId: savedOpportunities.opportunityId,
    title: opportunities.title,
    agencyName: opportunities.agencyName,
    dueAt: opportunities.dueAt,
    status: savedOpportunities.status,
    notes: savedOpportunities.notes,
    priority: savedOpportunities.priority,
    internalDeadline: savedOpportunities.internalDeadline,
    snapshotStatus: savedOpportunities.snapshotStatus,
    savedAt: savedOpportunities.savedAt,
    updatedAt: savedOpportunities.updatedAt,
  };
}

function normalize(row: ReturnType<typeof selection> extends never ? never : any): SavedOpportunityRecord {
  return {
    ...row,
    status: row.status as SavedOpportunityStatus,
    snapshotStatus: row.snapshotStatus as SavedOpportunitySnapshotStatus,
  };
}

export async function getSavedOpportunity(
  opportunityId: string,
): Promise<SavedOpportunityRecord | null> {
  const db = getDb();
  const [row] = await db
    .select(selection())
    .from(savedOpportunities)
    .innerJoin(opportunities, eq(opportunities.id, savedOpportunities.opportunityId))
    .where(
      and(
        eq(savedOpportunities.opportunityId, opportunityId),
        isNull(savedOpportunities.companyProfileId),
      ),
    )
    .limit(1);

  return row ? normalize(row) : null;
}

export async function listSavedOpportunities(input: {
  status?: SavedOpportunityStatus;
}): Promise<SavedOpportunityRecord[]> {
  const db = getDb();
  const predicate = input.status
    ? and(
        isNull(savedOpportunities.companyProfileId),
        eq(savedOpportunities.status, input.status),
      )
    : isNull(savedOpportunities.companyProfileId);

  const rows = await db
    .select(selection())
    .from(savedOpportunities)
    .innerJoin(opportunities, eq(opportunities.id, savedOpportunities.opportunityId))
    .where(predicate)
    .orderBy(desc(savedOpportunities.updatedAt));

  return rows.map(normalize);
}

export async function saveOpportunity(input: {
  opportunityId: string;
}): Promise<SavedOpportunityRecord> {
  const db = getDb();
  await db
    .insert(savedOpportunities)
    .values({ opportunityId: input.opportunityId })
    .onConflictDoNothing();

  const saved = await getSavedOpportunity(input.opportunityId);
  if (!saved) {
    throw new Error("Opportunity could not be saved.");
  }
  return saved;
}

export async function updateSavedOpportunity(
  opportunityId: string,
  input: UpdateSavedOpportunityInput,
): Promise<SavedOpportunityRecord> {
  let existing = await getSavedOpportunity(opportunityId);
  if (!existing) {
    existing = await saveOpportunity({ opportunityId });
  }

  if (input.status !== undefined && !isSavedOpportunityStatus(input.status)) {
    throw new Error("Invalid saved opportunity status.");
  }
  if (input.priority !== undefined) validatePriority(input.priority);
  if (input.internalDeadline !== undefined && input.internalDeadline !== null) {
    if (Number.isNaN(input.internalDeadline.getTime())) {
      throw new Error("Internal deadline must be a valid date.");
    }
  }

  const values: Partial<typeof savedOpportunities.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.status !== undefined) values.status = input.status;
  if (input.notes !== undefined) values.notes = input.notes;
  if (input.priority !== undefined) values.priority = input.priority;
  if (input.internalDeadline !== undefined) values.internalDeadline = input.internalDeadline;
  if (input.status === "pursuing" && existing.snapshotStatus === "not_required") {
    values.snapshotStatus = "incomplete";
  }

  await db
    .update(savedOpportunities)
    .set(values)
    .where(
      and(
        eq(savedOpportunities.opportunityId, opportunityId),
        isNull(savedOpportunities.companyProfileId),
      ),
    );

  const updated = await getSavedOpportunity(opportunityId);
  if (!updated) throw new Error("Saved opportunity could not be updated.");
  return updated;
}

export async function setSavedOpportunitySnapshotStatus(
  opportunityId: string,
  snapshotStatus: SavedOpportunitySnapshotStatus,
): Promise<SavedOpportunityRecord> {
  if (!["not_required", "incomplete", "complete", "blocked"].includes(snapshotStatus)) {
    throw new Error("Invalid saved opportunity snapshot status.");
  }

  const db = getDb();
  await db
    .update(savedOpportunities)
    .set({ snapshotStatus, updatedAt: new Date() })
    .where(
      and(
        eq(savedOpportunities.opportunityId, opportunityId),
        isNull(savedOpportunities.companyProfileId),
      ),
    );

  const updated = await getSavedOpportunity(opportunityId);
  if (!updated) throw new Error("Saved opportunity could not be updated.");
  return updated;
}

export async function deleteSavedOpportunity(opportunityId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(savedOpportunities)
    .where(
      and(
        eq(savedOpportunities.opportunityId, opportunityId),
        isNull(savedOpportunities.companyProfileId),
      ),
    )
    .returning({ id: savedOpportunities.id });
  return deleted.length > 0;
}
