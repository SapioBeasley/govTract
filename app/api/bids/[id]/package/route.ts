import { NextResponse } from "next/server";

import { getBidWorkspace } from "@/lib/bids/workspace";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "bid";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Invalid bid workspace id." } }, { status: 400 });
  }
  const workspace = await getBidWorkspace(id);
  if (!workspace) {
    return NextResponse.json({ error: { message: "Bid workspace was not found." } }, { status: 404 });
  }
  const fullBid = workspace.sections.find((section) => section.metadata.fullBid === true);
  if (!fullBid?.content?.trim()) {
    return NextResponse.json({ error: { message: "Generate and save the full bid before packaging." } }, { status: 409 });
  }
  if (!workspace.finalReview.readyForHumanReview || !workspace.finalReviewApprovalCurrent) {
    return NextResponse.json(
      { error: { message: "Resolve package blockers and approve the exact current bid before download." } },
      { status: 409 },
    );
  }

  const supporting = workspace.finalReview.sourceChecks.filter((check) =>
    check.originalRequired || ["form", "certification", "bonding", "insurance", "insurance_bonding", "license"].includes(check.kind),
  );
  const manifest = [
    "# Package manifest",
    "",
    `Bid: ${workspace.title}`,
    `Workspace: ${workspace.id}`,
    `Source snapshot: ${workspace.sourceSnapshot.pursuitSnapshotId ?? "unavailable"}`,
    `Document fingerprint: ${workspace.sourceSnapshot.documentSetFingerprint ?? "unavailable"}`,
    `Approved package fingerprint: ${workspace.finalReview.reviewFingerprint}`,
    "",
    "Included:",
    "- Full bid response (below)",
    ...supporting.filter((item) => item.originalConfirmed).map((item) => `- Supporting item confirmed: ${item.text}`),
    "",
    "Still external / verify at authoritative portal:",
    ...supporting.filter((item) => !item.originalConfirmed).map((item) => `- ${item.text}`),
    ...(workspace.finalReview.submission.portalUrl
      ? [`- Submission destination: ${workspace.finalReview.submission.portalUrl}`]
      : ["- Submission destination is not verified"]),
    "",
    "# Full bid response",
    "",
    fullBid.content.trim(),
    "",
  ].join("\n");

  return new NextResponse(manifest, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(workspace.title)}-package.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
