import { NextResponse } from "next/server";

import {
  deleteSavedOpportunity,
  getSavedOpportunity,
  isSavedOpportunityStatus,
  saveOpportunity,
  updateSavedOpportunity,
  type SavedOpportunityRecord,
  type UpdateSavedOpportunityInput,
} from "@/lib/opportunities/saved";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function publicSaved(saved: SavedOpportunityRecord | null) {
  if (!saved) return null;
  return {
    ...saved,
    dueAt: saved.dueAt?.toISOString() ?? null,
    internalDeadline: saved.internalDeadline?.toISOString() ?? null,
    savedAt: saved.savedAt.toISOString(),
    updatedAt: saved.updatedAt.toISOString(),
  };
}

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_saved_opportunity", message } },
    { status: 400 },
  );
}

async function parsePatch(request: Request): Promise<UpdateSavedOpportunityInput | NextResponse> {
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

  const patch: UpdateSavedOpportunityInput = {};
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!isSavedOpportunityStatus(body.status)) return invalid("Unknown pursuit status.");
    patch.status = body.status;
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
  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    if (
      typeof body.priority !== "number" ||
      !Number.isInteger(body.priority) ||
      body.priority < 0 ||
      body.priority > 5
    ) {
      return invalid("Priority must be an integer from 0 through 5.");
    }
    patch.priority = body.priority;
  }
  if (Object.prototype.hasOwnProperty.call(body, "internalDeadline")) {
    if (body.internalDeadline === null || body.internalDeadline === "") {
      patch.internalDeadline = null;
    } else if (typeof body.internalDeadline === "string") {
      const parsedDeadline = new Date(body.internalDeadline);
      if (Number.isNaN(parsedDeadline.getTime())) return invalid("Internal deadline is invalid.");
      patch.internalDeadline = parsedDeadline;
    } else {
      return invalid("Internal deadline must be an ISO date string or null.");
    }
  }

  return patch;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    return NextResponse.json({ saved: publicSaved(await getSavedOpportunity(id)) });
  } catch {
    return NextResponse.json(
      { error: { code: "saved_opportunity_unavailable", message: "Saved state is temporarily unavailable." } },
      { status: 503 },
    );
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    return NextResponse.json({ saved: publicSaved(await saveOpportunity({ opportunityId: id })) });
  } catch {
    return NextResponse.json(
      { error: { code: "save_failed", message: "Opportunity could not be saved." } },
      { status: 409 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");
  const patch = await parsePatch(request);
  if (patch instanceof NextResponse) return patch;

  try {
    return NextResponse.json({ saved: publicSaved(await updateSavedOpportunity(id, patch)) });
  } catch {
    return NextResponse.json(
      { error: { code: "saved_update_failed", message: "Saved opportunity could not be updated." } },
      { status: 409 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    await deleteSavedOpportunity(id);
    return NextResponse.json({ saved: null });
  } catch {
    return NextResponse.json(
      { error: { code: "saved_delete_failed", message: "Saved opportunity could not be removed." } },
      { status: 409 },
    );
  }
}
