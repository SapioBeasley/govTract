import { NextResponse } from "next/server";

import { approveBidPackage, getBidPackageStatus } from "@/lib/bids/package-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ packageStatus: await getBidPackageStatus(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package status could not be loaded.";
    return NextResponse.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 400 });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ packageStatus: await approveBidPackage(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package approval could not be saved.";
    return NextResponse.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
