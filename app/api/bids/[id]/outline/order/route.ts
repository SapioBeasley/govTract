import { NextResponse } from "next/server";

import { reorderBidOutlineSections } from "@/lib/bids/outline-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).sectionIds) ||
    !(parsed as { sectionIds: unknown[] }).sectionIds.every((value) => typeof value === "string" && UUID.test(value))) {
    return NextResponse.json({ error: { message: "Valid response section ids are required." } }, { status: 400 });
  }
  try {
    const { sectionIds } = parsed as { sectionIds: string[] };
    return NextResponse.json({ workspace: await reorderBidOutlineSections(id, sectionIds) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Response sections could not be reordered.";
    return NextResponse.json({ error: { message } }, { status: 409 });
  }
}
