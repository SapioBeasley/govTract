import { NextResponse } from "next/server";

import { updateBidOutlineSection, type UpdateBidOutlineSectionInput } from "@/lib/bids/outline-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sectionId: string }> }) {
  const { id, sectionId } = await context.params;
  if (!UUID.test(id) || !UUID.test(sectionId)) {
    return NextResponse.json({ error: { message: "Bid workspace or response section id is invalid." } }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: { message: "Request body must be a JSON object." } }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const allowed = ["title", "instructions", "content", "verifiedVendorFacts", "reviewedCurrentSource"];
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key)) ||
      (body.title !== undefined && typeof body.title !== "string") ||
      (body.instructions !== undefined && body.instructions !== null && typeof body.instructions !== "string") ||
      (body.content !== undefined && body.content !== null && typeof body.content !== "string") ||
      (body.verifiedVendorFacts !== undefined && body.verifiedVendorFacts !== true) ||
      (body.reviewedCurrentSource !== undefined && body.reviewedCurrentSource !== true)) {
    return NextResponse.json({ error: { message: "Invalid response section changes." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ workspace: await updateBidOutlineSection(id, sectionId, body as UpdateBidOutlineSectionInput) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Response section could not be updated.";
    return NextResponse.json({ error: { message } }, {
      status: message === "Bid response section was not found" ? 404 : 409,
    });
  }
}
