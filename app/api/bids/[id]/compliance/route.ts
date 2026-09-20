import { NextResponse } from "next/server";

import { generateBidComplianceMatrix } from "@/lib/bids/compliance-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    const workspace = await generateBidComplianceMatrix(id);
    if (!workspace) return NextResponse.json({ error: { message: "Bid workspace was not found." } }, { status: 404 });
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compliance matrix could not be prepared.";
    return NextResponse.json({ error: { message } }, { status: message === "Bid workspace was not found" ? 404 : 409 });
  }
}
