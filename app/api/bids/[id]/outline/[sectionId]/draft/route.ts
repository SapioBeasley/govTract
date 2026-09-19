import { NextResponse } from "next/server";

import { generateBidSectionDraft } from "@/lib/bids/draft-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only production entrypoint for AI bid drafting: an explicit POST with a fresh click ID. */
export async function POST(request: Request, context: { params: Promise<{ id: string; sectionId: string }> }) {
  const { id, sectionId } = await context.params;
  if (!UUID.test(id) || !UUID.test(sectionId)) {
    return NextResponse.json({ error: { message: "Bid workspace or section id is invalid." } }, { status: 400 });
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
    return NextResponse.json({ error: { message: "Explicit manual draft request id and replace flag are required." } }, { status: 400 });
  }
  const { requestId, replace } = parsed as { requestId: string; replace: boolean };
  try {
    const generation = await generateBidSectionDraft({
      workspaceId: id, sectionId, requestId, replace,
    });
    return NextResponse.json({ generation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid draft could not be generated.";
    return NextResponse.json({ error: { message } }, {
      status: /was not found/i.test(message) ? 404 : /invalid/i.test(message) ? 400 : 409,
    });
  }
}
