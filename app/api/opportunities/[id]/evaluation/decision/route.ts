import { NextResponse } from "next/server";

import {
  isOpportunityDecision,
  recordOpportunityDecision,
} from "@/lib/opportunities/evaluation/persistence";
import { loadOpportunityEvaluationState } from "@/lib/opportunities/evaluation/service";
import { updateSavedOpportunity } from "@/lib/opportunities/saved";
import { publicDecision } from "../route";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_opportunity_decision", message } },
    { status: 400 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("Request body must be a JSON object.");
  }
  const decision = (body as Record<string, unknown>).decision;
  if (!isOpportunityDecision(decision)) {
    return invalid("Decision must be pursue, do_not_pursue, or revisit.");
  }

  try {
    const state = await loadOpportunityEvaluationState(id);
    if (!state.profileAvailable) {
      return NextResponse.json(
        {
          error: {
            code: "company_profile_missing",
            message: "Complete the company profile before recording an evaluation decision.",
          },
        },
        { status: 409 },
      );
    }
    if (!state.evaluation) {
      return NextResponse.json(
        {
          error: {
            code: "evaluation_required",
            message: "Evaluate the opportunity before recording a decision.",
          },
        },
        { status: 409 },
      );
    }

    const savedStatus =
      decision === "pursue" ? "pursuing" : decision === "do_not_pursue" ? "no_bid" : "reviewing";
    const saved = await updateSavedOpportunity(id, { status: savedStatus });
    const recorded = await recordOpportunityDecision({
      opportunityId: id,
      companyProfileId: state.profileId,
      evaluationId: state.evaluation.id,
      decision,
    });

    return NextResponse.json({
      decision: publicDecision(recorded),
      savedStatus: saved.status,
      pursuitSnapshotStatus: saved.snapshotStatus,
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "opportunity_decision_failed",
          message: "The opportunity decision could not be recorded.",
        },
      },
      { status: 503 },
    );
  }
}
