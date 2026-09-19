import { NextResponse } from "next/server";

import {
  ensureBidWorkspaceForOpportunity,
  getBidWorkspaceForOpportunity,
} from "@/lib/bids/workspace";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_bid_workspace_request", message } },
    { status: 400 },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    return NextResponse.json({
      workspace: await getBidWorkspaceForOpportunity(id),
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "bid_workspace_unavailable",
          message: "Bid workspace is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    return NextResponse.json({
      workspace: await ensureBidWorkspaceForOpportunity(id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid workspace could not be created.";
    return NextResponse.json(
      {
        error: {
          code: message === "Opportunity was not found" ? "opportunity_not_found" : "bid_workspace_create_failed",
          message,
        },
      },
      { status: message === "Opportunity was not found" ? 404 : 409 },
    );
  }
}
