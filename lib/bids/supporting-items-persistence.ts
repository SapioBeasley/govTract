import { eq, sql } from "drizzle-orm";

import { getBidWorkspace } from "@/lib/bids/workspace";
import { bidWorkspaces } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";
import {
  deriveSupportingItems,
  evaluateSupportingChecklist,
  supportingChecklistFingerprint,
  type SupportingChecklistState,
} from "@/lib/bids/supporting-items";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseState(value: unknown): SupportingChecklistState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.fingerprint !== "string") return null;
  const readyItemIds = Array.isArray(row.readyItemIds)
    ? row.readyItemIds.filter((id): id is string => typeof id === "string")
    : [];
  const applicableItemIds = Array.isArray(row.applicableItemIds)
    ? row.applicableItemIds.filter((id): id is string => typeof id === "string")
    : [];
  return { fingerprint: row.fingerprint, readyItemIds, applicableItemIds };
}

async function storedMetadata(workspaceId: string) {
  const [row] = await getDb().select({ metadata: bidWorkspaces.metadata })
    .from(bidWorkspaces).where(eq(bidWorkspaces.id, workspaceId)).limit(1);
  return row?.metadata ?? null;
}

export async function getBidSupportingChecklist(workspaceId: string) {
  if (!UUID.test(workspaceId)) throw new Error("Bid workspace id is invalid.");
  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const metadata = await storedMetadata(workspaceId);
  const items = deriveSupportingItems({
    requirements: workspace.sourceRequirements,
    documents: workspace.sourceSnapshot.documents.map((document) => ({
      opportunityDocumentVersionId: document.opportunityDocumentVersionId,
      filename: document.filename,
    })),
  });
  const fingerprint = supportingChecklistFingerprint({
    requirements: workspace.sourceRequirements,
    documentSetFingerprint: workspace.sourceSnapshot.currentDocumentSetFingerprint ??
      workspace.sourceSnapshot.documentSetFingerprint,
  });
  const state = parseState(metadata?.supportingChecklist);
  const evaluation = evaluateSupportingChecklist(items, state, fingerprint);
  const ready = new Set(evaluation.readyItemIds);
  const applicable = new Set(evaluation.applicableItemIds);
  const blocking = new Set(evaluation.blockingItemIds);
  return {
    fingerprint,
    stateCurrent: evaluation.stateCurrent,
    readyForPackage: evaluation.readyForPackage,
    blockingItemIds: evaluation.blockingItemIds,
    readyItemIds: evaluation.readyItemIds,
    applicableItemIds: evaluation.applicableItemIds,
    items: items.map((item) => ({
      ...item,
      ready: ready.has(item.id),
      applicable: item.required ? true : applicable.has(item.id),
      blocking: blocking.has(item.id),
    })),
  };
}

export async function updateBidSupportingItem(
  workspaceId: string,
  itemId: string,
  input: { ready?: boolean; applicable?: boolean },
) {
  if (!UUID.test(workspaceId) || !UUID.test(itemId) ||
      (input.ready === undefined && input.applicable === undefined) ||
      Object.keys(input).some((key) => !["ready", "applicable"].includes(key))) {
    throw new Error("Invalid supporting checklist update.");
  }
  const current = await getBidSupportingChecklist(workspaceId);
  const item = current.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("Supporting checklist item was not found.");
  if (input.applicable !== undefined && !item.conditional) {
    throw new Error("Only conditional supporting items have applicability.");
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`supporting:${workspaceId}`}))`);
    const [row] = await tx.select({ metadata: bidWorkspaces.metadata })
      .from(bidWorkspaces).where(eq(bidWorkspaces.id, workspaceId)).limit(1);
    if (!row) throw new Error("Bid workspace was not found.");
    const stored = parseState(row.metadata?.supportingChecklist);
    const ready = new Set(stored?.fingerprint === current.fingerprint ? stored.readyItemIds : []);
    const applicable = new Set(
      stored?.fingerprint === current.fingerprint ? stored.applicableItemIds : [],
    );
    if (input.applicable !== undefined) {
      if (input.applicable) applicable.add(itemId);
      else {
        applicable.delete(itemId);
        ready.delete(itemId);
      }
    }
    if (input.ready !== undefined) {
      if (input.ready) ready.add(itemId);
      else ready.delete(itemId);
    }
    const metadata = {
      ...(row.metadata ?? {}),
      supportingChecklist: {
        fingerprint: current.fingerprint,
        readyItemIds: [...ready].sort(),
        applicableItemIds: [...applicable].sort(),
        updatedAt: new Date().toISOString(),
      },
    };
    await tx.update(bidWorkspaces).set({ metadata, updatedAt: new Date() })
      .where(eq(bidWorkspaces.id, workspaceId));
  });
  return getBidSupportingChecklist(workspaceId);
}
