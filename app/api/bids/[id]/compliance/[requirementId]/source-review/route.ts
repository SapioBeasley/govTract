import { NextResponse } from "next/server";
import { reviewBidRequirementSource } from "@/lib/bids/source-review-persistence";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string; requirementId: string }> };

export async function POST(request: Request, context: Context) {
  const { id, requirementId } = await context.params;
  if (!UUID.test(id) || !UUID.test(requirementId)) {
    return NextResponse.json({ error: { message: "Bid requirement id is invalid." } }, { status: 400 });
  }
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: { message: "Source review must be a JSON object." } }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  if ((body.level !== "required" && body.level !== "optional") ||
      typeof body.documentVersionId !== "string" || !UUID.test(body.documentVersionId) ||
      typeof body.excerpt !== "string" || body.excerpt.trim().length < 20 || body.excerpt.length > 480 ||
      typeof body.reviewerNote !== "string" || body.reviewerNote.trim().length < 10 ||
      body.reviewerNote.length > 2000 || body.confirmed !== true) {
    return NextResponse.json({ error: { message: "Choose a current source, copy its exact passage, state requiredness, explain the decision, and confirm your review." } }, { status: 400 });
  }
  try {
    const workspace = await reviewBidRequirementSource(id, requirementId, {
      level: body.level, documentVersionId: body.documentVersionId,
      excerpt: body.excerpt, reviewerNote: body.reviewerNote, confirmed: true,
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source review could not be verified.";
    return NextResponse.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
