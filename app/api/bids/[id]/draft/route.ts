import { NextResponse } from "next/server";

import { generateFullBidDraft, saveFullBidDraft } from "@/lib/bids/full-bid-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorStatus(message: string) {
  if (/was not found/i.test(message)) return 404;
  if (/invalid|required/i.test(message)) return 400;
  return 409;
}

/** Explicit user action only. No GET/render path invokes bid generation. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
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
    return NextResponse.json({
      error: { message: "Explicit manual generation request id and replace flag are required." },
    }, { status: 400 });
  }
  const { requestId, replace } = parsed as { requestId: string; replace: boolean };
  try {
    const generation = await generateFullBidDraft({ workspaceId: id, requestId, replace });
    return NextResponse.json({ generation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Full bid could not be generated.";
    return NextResponse.json({ error: { message } }, { status: errorStatus(message) });
  }
}

/** Plain save only. This route never invokes an AI provider. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => key !== "content") ||
      typeof (parsed as Record<string, unknown>).content !== "string") {
    return NextResponse.json({ error: { message: "Draft content is required." } }, { status: 400 });
  }
  try {
    const artifact = await saveFullBidDraft(id, (parsed as { content: string }).content);
    return NextResponse.json({ artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Full bid could not be saved.";
    return NextResponse.json({ error: { message } }, { status: errorStatus(message) });
  }
}
