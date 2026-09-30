import { NextResponse } from "next/server";

import { recordExternalSubmission } from "@/lib/bids/submission-persistence";
import { getBidWorkspace } from "@/lib/bids/workspace";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_bid_submission", message } },
    { status: 400 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Bid workspace id is invalid.");

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
  if (typeof body.submittedAt !== "string") {
    return invalid("Submission date/time is required.");
  }
  for (const key of ["confirmationNumber", "receiptUrl", "notes"] as const) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") {
      return invalid(`${key} must be text or null.`);
    }
  }

  try {
    const submission = await recordExternalSubmission(id, {
      submittedAt: body.submittedAt,
      confirmationNumber: body.confirmationNumber as string | null | undefined,
      receiptUrl: body.receiptUrl as string | null | undefined,
      notes: body.notes as string | null | undefined,
    });
    const workspace = await getBidWorkspace(id);
    return NextResponse.json({ submission, workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "External submission could not be recorded.";
    return NextResponse.json(
      {
        error: {
          code: message === "Bid workspace was not found"
            ? "bid_workspace_not_found"
            : "bid_submission_confirmation_failed",
          message,
        },
      },
      { status: message === "Bid workspace was not found" ? 404 : 409 },
    );
  }
}
