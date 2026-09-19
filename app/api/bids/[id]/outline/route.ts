import { NextResponse } from "next/server";

import { generateBidOutline } from "@/lib/bids/outline-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ workspace: await generateBidOutline(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid outline could not be prepared.";
    return NextResponse.json({ error: { message } }, {
      status: message === "Bid workspace was not found" ? 404 : 409,
    });
  }
}
