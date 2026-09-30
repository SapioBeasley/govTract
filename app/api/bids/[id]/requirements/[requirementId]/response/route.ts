import { NextResponse } from "next/server";

import { isBidResponseSourceType } from "@/lib/bids/requirement-questions";
import { updateBidRequirementResponse } from "@/lib/bids/requirement-response-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string; requirementId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, requirementId } = await context.params;
  if (!UUID.test(id) || !UUID.test(requirementId)) {
    return NextResponse.json({ error: { message: "Bid requirement id is invalid." } }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: { message: "Requirement response is required." } }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key) =>
    !["responseNotes", "responseSourceType", "responseSourceName"].includes(key))) {
    return NextResponse.json({ error: { message: "Unknown requirement response field." } }, { status: 400 });
  }
  if (body.responseNotes !== null && typeof body.responseNotes !== "string") {
    return NextResponse.json({ error: { message: "Requirement response must be text." } }, { status: 400 });
  }
  if (body.responseSourceType !== null && !isBidResponseSourceType(body.responseSourceType)) {
    return NextResponse.json({ error: { message: "Choose self, subcontractor, manufacturer, or other." } }, { status: 400 });
  }
  if (body.responseSourceName !== null && typeof body.responseSourceName !== "string") {
    return NextResponse.json({ error: { message: "Response source name must be text." } }, { status: 400 });
  }

  try {
    const workspace = await updateBidRequirementResponse(id, requirementId, {
      responseNotes: (body.responseNotes as string | null) ?? null,
      responseSourceType: (body.responseSourceType as import("@/lib/bids/requirement-questions").BidResponseSourceType | null) ?? null,
      responseSourceName: (body.responseSourceName as string | null) ?? null,
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requirement response could not be saved.";
    const notFound = /was not found/i.test(message);
    return NextResponse.json({ error: { message } }, { status: notFound ? 404 : 409 });
  }
}
