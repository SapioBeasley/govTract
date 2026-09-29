import { and, eq, sql } from "drizzle-orm";

import { generateBidSectionDraft } from "@/lib/bids/draft-persistence";
import { FULL_BID_WORKFLOW, findFullBidSection, generationBlockers } from "@/lib/bids/full-bid";
import { getBidWorkspace, type BidWorkspaceSection } from "@/lib/bids/workspace";
import { bidSections, bidWorkspaces } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

function wordCount(value: string) {
  const text = value.trim();
  return text ? text.split(/\s+/).length : 0;
}

function legacyContent(sections: BidWorkspaceSection[]) {
  return sections
    .filter((section) => !findFullBidSection([section]) && section.content?.trim())
    .map((section) => `## ${section.title}\n\n${section.content!.trim()}`)
    .join("\n\n");
}

export async function ensureFullBidSection(workspaceId: string) {
  const current = await getBidWorkspace(workspaceId);
  if (!current) throw new Error("Bid workspace was not found.");
  const existing = findFullBidSection(current.sections);
  if (existing) return existing;

  const blockers = generationBlockers({ snapshot: current.sourceSnapshot, requirements: current.sourceRequirements });
  if (blockers.length) throw new Error(blockers.join(" "));

  const source = current.sourceRequirements!;
  const migrated = legacyContent(current.sections);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const rows = await tx.select().from(bidSections).where(eq(bidSections.bidWorkspaceId, workspaceId));
    if (rows.some((row) => row.metadata?.workflow === FULL_BID_WORKFLOW || row.title === "Full bid draft")) return;

    await tx.insert(bidSections).values({
      bidWorkspaceId: workspaceId,
      title: "Full bid draft",
      instructions: "Create one coherent response that follows the solicitation scope, response instructions, pricing/submission requirements, amendments, forms, and other relevant retained source material. Use [NEEDS INPUT: ...] for unknown bidder facts.",
      content: migrated || null,
      status: "draft",
      requirementLinks: { sourceRequirementKeys: source.requirements.map((requirement) => requirement.requirementKey) },
      sortOrder: 0,
      wordCount: wordCount(migrated),
      metadata: {
        workflow: FULL_BID_WORKFLOW,
        migratedFromSectionIds: current.sections.filter((section) => !findFullBidSection([section])).map((section) => section.id),
        understandingId: source.understandingId,
        understandingStale: source.isStale,
        pursuitSnapshotId: current.sourceSnapshot.pursuitSnapshotId,
        documentSetFingerprint: current.sourceSnapshot.documentSetFingerprint,
        snapshotStatus: current.sourceSnapshot.snapshotStatus,
        snapshotStale: current.sourceSnapshot.stale,
      },
    });
  });

  const loaded = await getBidWorkspace(workspaceId);
  const section = loaded ? findFullBidSection(loaded.sections) : null;
  if (!section) throw new Error("Full bid draft could not be prepared.");
  return section;
}

export async function generateFullBidDraft(input: { workspaceId: string; requestId: string }) {
  const section = await ensureFullBidSection(input.workspaceId);
  return generateBidSectionDraft({
    workspaceId: input.workspaceId,
    sectionId: section.id,
    requestId: input.requestId,
    replace: true,
  });
}

export async function updateFullBidContent(workspaceId: string, content: string) {
  if (typeof content !== "string" || content.length > 400_000) {
    throw new Error("Full bid content is invalid or too long.");
  }
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const section = findFullBidSection(workspace.sections);
  if (!section) throw new Error("Generate the full bid before editing it.");

  const metadata = { ...section.metadata };
  delete metadata.verifiedVendorFactsFingerprint;
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(bidSections).set({
      content,
      wordCount: wordCount(content),
      status: "draft",
      metadata,
      updatedAt: new Date(),
    }).where(and(
      eq(bidSections.id, section.id),
      eq(bidSections.bidWorkspaceId, workspaceId),
      sql`${bidSections.content} IS NOT DISTINCT FROM ${section.content}`,
    )).returning({ id: bidSections.id });
    if (!rows.length) return false;

    await tx.update(bidWorkspaces).set({
      metadata: {
        ...(await tx.select({ metadata: bidWorkspaces.metadata }).from(bidWorkspaces)
          .where(eq(bidWorkspaces.id, workspaceId)).limit(1))[0]?.metadata,
        reviewState: "needs_changes",
      },
      updatedAt: new Date(),
    }).where(eq(bidWorkspaces.id, workspaceId));
    return true;
  });
  if (!updated) throw new Error("The draft changed before this save. Refresh and retry.");
  return getBidWorkspace(workspaceId);
}
