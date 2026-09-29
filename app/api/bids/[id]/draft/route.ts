import { NextResponse } from "next/server";

import { generateFullBidDraft, updateFullBidContent } from "@/lib/bids/full-bid-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidId(id: string) {
  return !UUID.test(id);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (invalidId(id)) return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });

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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (invalidId(id)) return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "content") ||
      typeof (body as Record<string, unknown>).content !== "string") {
    return NextResponse.json({ error: { message: "Full bid content is required." } }, { status: 400 });
  }

  try {
    return NextResponse.json({ workspace: await updateFullBidContent(id, (body as { content: string }).content) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid could not be saved.";
    return NextResponse.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
