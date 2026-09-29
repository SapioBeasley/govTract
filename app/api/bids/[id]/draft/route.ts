import { NextResponse } from "next/server";

import { generateFullBidDraft } from "@/lib/bids/draft-persistence";

export const runtime = "nodejs";

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
