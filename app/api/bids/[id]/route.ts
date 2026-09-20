import { NextResponse } from "next/server";

import {
  getBidWorkspace,
  isBidWorkspaceReviewState,
  isBidWorkspaceStatus,
  updateBidWorkspace,
  type UpdateBidWorkspaceInput,
} from "@/lib/bids/workspace";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_bid_workspace", message } },
    { status: 400 },
  );
}

async function parsePatch(request: Request): Promise<UpdateBidWorkspaceInput | NextResponse> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return invalid("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("Request body must be a JSON object.");
  }

  const body = parsed as Record<string, unknown>;
  const patch: UpdateBidWorkspaceInput = {};

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!isBidWorkspaceStatus(body.status)) return invalid("Unknown workspace status.");
    patch.status = body.status;
  }
  if (Object.prototype.hasOwnProperty.call(body, "reviewState")) {
    if (!isBidWorkspaceReviewState(body.reviewState)) return invalid("Unknown review state.");
    patch.reviewState = body.reviewState;
  }
  if (Object.prototype.hasOwnProperty.call(body, "humanReviewConfirmed")) {
    if (typeof body.humanReviewConfirmed !== "boolean") {
      return invalid("Personal review confirmation must be a boolean.");
    }
    patch.humanReviewConfirmed = body.humanReviewConfirmed;
  }
  if (Object.prototype.hasOwnProperty.call(body, "confirmedOriginalForms")) {
    if (!Array.isArray(body.confirmedOriginalForms) ||
        body.confirmedOriginalForms.length > 200 ||
        body.confirmedOriginalForms.some((id: unknown) => typeof id !== "string") ||
        new Set(body.confirmedOriginalForms).size !== body.confirmedOriginalForms.length) {
      return invalid("Original form confirmations must be unique source requirement ids.");
    }
    patch.confirmedOriginalForms = body.confirmedOriginalForms as string[];
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return invalid("Notes must be text or null.");
    }
    if (typeof body.notes === "string" && body.notes.length > 20_000) {
      return invalid("Notes are too long.");
    }
    patch.notes = body.notes as string | null;
  }

  return patch;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Bid workspace id is invalid.");

  try {
    const workspace = await getBidWorkspace(id);
    if (!workspace) {
      return NextResponse.json(
        { error: { code: "bid_workspace_not_found", message: "Bid workspace was not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ workspace });
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

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Bid workspace id is invalid.");

  const patch = await parsePatch(request);
  if (patch instanceof NextResponse) return patch;

  try {
    return NextResponse.json({ workspace: await updateBidWorkspace(id, patch) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid workspace could not be updated.";
    return NextResponse.json(
      {
        error: {
          code: message === "Bid workspace was not found" ? "bid_workspace_not_found" : "bid_workspace_update_failed",
          message,
        },
      },
      { status: message === "Bid workspace was not found" ? 404 : 409 },
    );
  }
}
