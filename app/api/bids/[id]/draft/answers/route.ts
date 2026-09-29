import { NextResponse } from "next/server";

import { applyBidderAnswersToFullBid } from "@/lib/bids/bidder-input-persistence";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit user action only. Typing, saving, rendering, and packaging never call AI. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Invalid bid workspace id." } }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: { message: "Bidder answers are required." } }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["requestId", "answers"].includes(key)) ||
      typeof body.requestId !== "string" || !UUID.test(body.requestId) ||
      !Array.isArray(body.answers)) {
    return NextResponse.json({
      error: { message: "Explicit manual bidder-answer request id and answers are required." },
    }, { status: 400 });
  }

  try {
    const generation = await applyBidderAnswersToFullBid({
      workspaceId: id,
      requestId: body.requestId,
      answers: body.answers as Array<{ question: string; answer: string }>,
    });
    return NextResponse.json({ generation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid answers could not be applied.";
    return NextResponse.json({ error: { message } }, {
      status: /was not found/i.test(message) ? 404 : /invalid/i.test(message) ? 400 : 409,
    });
  }
}
