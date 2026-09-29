import { buildBidPackage } from "@/lib/bids/package";
import { findFullBidSection } from "@/lib/bids/full-bid";
import { getBidWorkspace } from "@/lib/bids/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const workspace = await getBidWorkspace(id);
  if (!workspace) return new Response("Not found", { status: 404 });
  if (!workspace.finalReviewApprovalCurrent) {
    return new Response("Approve the exact current bid package before downloading it.", { status: 409 });
  }
  const draft = findFullBidSection(workspace.sections);
  if (!draft?.content?.trim()) return new Response("Full bid draft is missing.", { status: 409 });

  const manifest = {
    workspaceId: workspace.id,
    opportunityId: workspace.opportunityId,
    title: workspace.title,
    reviewFingerprint: workspace.finalReview.reviewFingerprint,
    approved: true,
    sourceSnapshotId: workspace.sourceSnapshot.pursuitSnapshotId,
    sourceFingerprint: workspace.sourceSnapshot.documentSetFingerprint,
    response: { filename: "bid-response.txt", sectionId: draft.id, wordCount: draft.wordCount },
    supportingItems: workspace.finalReview.sourceChecks.map((item) => ({
      requirementId: item.requirementId,
      text: item.text,
      required: item.mandatory,
      includedOrReady: item.originalConfirmed,
      handling: "external_supporting_item",
    })),
    submission: workspace.finalReview.submission,
  };
  const archive = buildBidPackage({ title: workspace.title, content: draft.content, manifest });
  const filename = (workspace.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "bid") + "-package.zip";
  return new Response(archive, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
