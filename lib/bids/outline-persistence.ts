import { and, asc, eq, sql } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import { planBidOutline } from "@/lib/bids/outline";
import { bidSections } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

export type UpdateBidOutlineSectionInput = {
  title?: string;
  instructions?: string | null;
  content?: string | null;
};

function wordCount(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Explicit, deterministic action. Existing sections are not regenerated or overwritten:
 * user edits, ordering, and links stay attached to their original source understanding.
 * Transaction-level locking prevents two simultaneous outline requests from duplicating rows.
 */
export async function generateBidOutline(workspaceId: string) {
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found");
  if (workspace.sections.length) return workspace;
  const source = workspace.sourceRequirements;
  if (!source || !source.requirements.length) {
    throw new Error("Structured solicitation requirements are not available yet.");
  }
  const planned = planBidOutline(source.requirements);
  if (!planned.length) throw new Error("No solicitation response sections could be identified.");

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const existing = await tx
      .select({ id: bidSections.id })
      .from(bidSections)
      .where(eq(bidSections.bidWorkspaceId, workspaceId))
      .limit(1);
    if (existing.length) return;

    await tx.insert(bidSections).values(planned.map((section) => ({
      bidWorkspaceId: workspaceId,
      ...section,
      metadata: {
        ...section.metadata,
        generatorVersion: "deterministic-v1",
        understandingId: source.understandingId,
        understandingStale: source.isStale,
        completenessStatus: source.completenessStatus,
        pursuitSnapshotId: workspace.sourceSnapshot.pursuitSnapshotId,
        documentSetFingerprint: workspace.sourceSnapshot.documentSetFingerprint,
        snapshotStatus: workspace.sourceSnapshot.snapshotStatus,
        snapshotStale: workspace.sourceSnapshot.stale,
      },
    })));
  });
  return getBidWorkspace(workspaceId);
}

export async function updateBidOutlineSection(
  workspaceId: string,
  sectionId: string,
  input: UpdateBidOutlineSectionInput,
) {
  if (!Object.keys(input).length) throw new Error("No response section changes were provided.");
  if (input.title !== undefined && (!input.title.trim() || input.title.length > 200)) {
    throw new Error("Response section title must contain 1–200 characters.");
  }
  if (input.instructions !== undefined && input.instructions !== null && input.instructions.length > 20_000) {
    throw new Error("Response section instructions are too long.");
  }
  if (input.content !== undefined && input.content !== null && input.content.length > 200_000) {
    throw new Error("Response section content is too long.");
  }

  const db = getDb();
  const modified = await db.update(bidSections).set({
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions?.trim() || null }),
    ...(input.content === undefined ? {} : {
      content: input.content,
      wordCount: wordCount(input.content),
    }),
    updatedAt: new Date(),
  }).where(and(
    eq(bidSections.bidWorkspaceId, workspaceId),
    eq(bidSections.id, sectionId),
  )).returning({ id: bidSections.id });
  if (!modified.length) throw new Error("Bid response section was not found.");
  return getBidWorkspace(workspaceId);
}

export async function reorderBidOutlineSections(workspaceId: string, sectionIds: string[]) {
  if (!Array.isArray(sectionIds) || !sectionIds.length || new Set(sectionIds).size !== sectionIds.length) {
    throw new Error("Each bid response section must appear exactly once.");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const stored = await tx.select({ id: bidSections.id }).from(bidSections)
      .where(eq(bidSections.bidWorkspaceId, workspaceId))
      .orderBy(asc(bidSections.sortOrder), asc(bidSections.id));
    if (stored.length !== sectionIds.length || stored.some((section) => !sectionIds.includes(section.id))) {
      throw new Error("Each bid response section must appear exactly once.");
    }
    for (const [sortOrder, id] of sectionIds.entries()) {
      await tx.update(bidSections).set({ sortOrder, updatedAt: new Date() })
        .where(and(eq(bidSections.id, id), eq(bidSections.bidWorkspaceId, workspaceId)));
    }
  });
  return getBidWorkspace(workspaceId);
}
