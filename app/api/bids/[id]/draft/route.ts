import { NextResponse } from "next/server";

import { generateFullBidDraft } from "@/lib/bids/draft-persistence";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { materializeRequirementsForUnderstanding } from "@/lib/procurement/requirements/persistence";
import { isSolicitationRequirementSetDraftable } from "@/lib/procurement/requirements/readiness";
import { ensureStoredSnapshotExtractions } from "@/lib/procurement/pursuits/extraction-recovery";
import { refreshBidSourceSnapshot } from "@/lib/procurement/pursuits/manual-refresh";
import { getPursuitSnapshot } from "@/lib/procurement/pursuits/snapshot";
import { generateSolicitationUnderstanding } from "@/lib/procurement/understanding/generation";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit user action only. Rendering, editing, saving, refreshes, and packaging never call the model. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Invalid bid workspace id." } }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => !["requestId", "replace"].includes(key)) ||
      typeof (parsed as Record<string, unknown>).requestId !== "string" ||
      !UUID.test((parsed as { requestId: string }).requestId) ||
      typeof (parsed as Record<string, unknown>).replace !== "boolean") {
    return NextResponse.json(
      { error: { message: "Explicit manual bid generation request id and replace flag are required." } },
      { status: 400 },
    );
  }
  try {
    const source = await refreshBidSourceSnapshot(id);
    if (source.state !== "complete") {
      throw new Error("The current solicitation package could not be fully retained.");
    }
    const refreshedWorkspace = await getBidWorkspace(id);
    const snapshotId = refreshedWorkspace?.sourceSnapshot.pursuitSnapshotId;
    const snapshot = snapshotId ? await getPursuitSnapshot(snapshotId) : null;
    if (!snapshot || snapshot.status !== "complete" ||
        snapshot.documents.some((document) => document.status !== "stored")) {
      throw new Error("The retained solicitation package is incomplete after source recovery.");
    }

    const extraction = await ensureStoredSnapshotExtractions(snapshot);
    if (extraction.failed > 0) {
      throw new Error("One or more retained source documents could not be extracted for bid generation.");
    }
    let workspace = await getBidWorkspace(id);
    if (!workspace) throw new Error("Bid workspace was not found.");

    if (!isSolicitationRequirementSetDraftable(workspace.sourceRequirements)) {
      const understanding = await generateSolicitationUnderstanding({
        opportunityId: workspace.opportunityId,
        trigger: "manual",
        explicitManualUserAction: true,
      });
      if (understanding.state !== "completed" && understanding.state !== "reused") {
        const reason = "reason" in understanding ? understanding.reason : "understanding_generation_failed";
        throw new Error(`Current solicitation understanding could not be refreshed (${reason}). No bid draft was generated.`);
      }
      await materializeRequirementsForUnderstanding(understanding.understandingId);
      workspace = await getBidWorkspace(id);
      if (!isSolicitationRequirementSetDraftable(workspace?.sourceRequirements)) {
        throw new Error("Current solicitation understanding remains incomplete after the explicit refresh. No bid draft was generated.");
      }
    }

    const generation = await generateFullBidDraft({
      workspaceId: id,
      requestId: (parsed as { requestId: string }).requestId,
      replace: (parsed as { replace: boolean }).replace,
    });
    return NextResponse.json({ generation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid could not be generated.";
    return NextResponse.json({ error: { message } }, {
      status: /was not found/i.test(message) ? 404 : /invalid/i.test(message) ? 400 : 409,
    });
  }
}
