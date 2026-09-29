import { NextResponse } from "next/server";

import {
  getBidSupportingChecklist,
  updateBidSupportingItem,
} from "@/lib/bids/supporting-items-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    const checklist = await getBidSupportingChecklist(id);
    return NextResponse.json({ checklist });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supporting checklist could not be loaded.";
    return NextResponse.json({ error: { message } }, {
      status: /not found/i.test(message) ? 404 : 400,
    });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = await request.json(); } catch {
    return NextResponse.json({ error: { message: "Valid JSON is required." } }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: { message: "A supporting checklist update is required." } }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.itemId !== "string" || !UUID.test(body.itemId) ||
      (body.ready === undefined && body.applicable === undefined) ||
      (body.ready !== undefined && typeof body.ready !== "boolean") ||
      (body.applicable !== undefined && typeof body.applicable !== "boolean") ||
      Object.keys(body).some((key) => !["itemId", "ready", "applicable"].includes(key))) {
    return NextResponse.json({ error: { message: "Supporting checklist update is invalid." } }, { status: 400 });
  }
  try {
    const checklist = await updateBidSupportingItem(id, body.itemId, {
      ...(typeof body.ready === "boolean" ? { ready: body.ready } : {}),
      ...(typeof body.applicable === "boolean" ? { applicable: body.applicable } : {}),
    });
    return NextResponse.json({ checklist });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supporting checklist could not be updated.";
    return NextResponse.json({ error: { message } }, {
      status: /not found/i.test(message) ? 404 : 400,
    });
  }
}
