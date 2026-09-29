import { NextResponse } from "next/server";

import { generateFullBidDraft } from "@/lib/bids/full-bid-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  const requestId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).requestId : null;
  if (typeof requestId !== "string" || !UUID.test(requestId)) {
    return NextResponse.json({ error: { message: "A fresh manual generation request id is required." } }, { status: 400 });
  }

  try {
    return NextResponse.json({ generation: await generateFullBidDraft({ workspaceId: id, requestId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid could not be generated.";
    return NextResponse.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
