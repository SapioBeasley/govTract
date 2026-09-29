import { eq, sql } from "drizzle-orm";

import { generateBidSectionDraft } from "@/lib/bids/draft-persistence";
import { FULL_BID_WORKFLOW, findFullBidSection, generationBlockers } from "@/lib/bids/full-bid";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { bidSections } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

function wordCount(value: string) {
  const text = value.trim();
  return text ? text.split(/\s+/).length : 0;
}

function legacyContent(sections: Awaited<ReturnType<typeof getBidWorkspace>> extends infer T
  ? T extends { sections: infer S } ? S : never : never) {
  if (!Array.isArray(sections)) return "";
  return sections
    .filter((section: any) => section && !findFullBidSection([section]) && typeof section.content === "string" && section.content.trim())
    .map((section: any) => `## ${section.title}\n\n${section.content.trim()}`)
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
