import { NextResponse } from "next/server";

import { isComplianceStatus } from "@/lib/bids/compliance";
import { updateBidComplianceRequirement } from "@/lib/bids/compliance-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string; requirementId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, requirementId } = await context.params;
  if (!UUID.test(id) || !UUID.test(requirementId)) {
    return NextResponse.json({ error: { message: "Bid requirement id is invalid." } }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: { message: "Request body must be a JSON object." } }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (body.status !== undefined && !isComplianceStatus(body.status)) {
    return NextResponse.json({ error: { message: "Unknown compliance response status." } }, { status: 400 });
  }
  if (
    body.responseNotes !== undefined &&
    body.responseNotes !== null &&
    (typeof body.responseNotes !== "string" || body.responseNotes.length > 10_000)
  ) {
    return NextResponse.json({ error: { message: "Response notes must be text of at most 10,000 characters." } }, { status: 400 });
  }
  if (body.status === undefined && body.responseNotes === undefined) {
    return NextResponse.json({ error: { message: "A compliance status or response note is required." } }, { status: 400 });
  }
  try {
    const workspace = await updateBidComplianceRequirement(id, requirementId, {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.responseNotes === undefined ? {} : { responseNotes: body.responseNotes as string | null }),
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid requirement could not be updated.";
    const notFound = message === "Bid workspace was not found" || message === "Bid requirement was not found";
    return NextResponse.json({ error: { message } }, { status: notFound ? 404 : 409 });
  }
}
