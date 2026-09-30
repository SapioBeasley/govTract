import { NextResponse } from "next/server";

import { generateBidRequirementQuestions } from "@/lib/bids/requirement-questions";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    const workspace = await generateBidRequirementQuestions(id);
    if (!workspace) {
      return NextResponse.json({ error: { message: "Bid workspace was not found." } }, { status: 404 });
    }
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requirement questions could not be generated.";
    return NextResponse.json({ error: { message } }, { status: /was not found/i.test(message) ? 404 : 409 });
  }
}
