import { NextResponse } from "next/server";

import {
  OpportunityEvaluationPrerequisiteError,
  loadOpportunityEvaluationState,
  runOpportunityEvaluation,
} from "@/lib/opportunities/evaluation/service";
import {
  serializeOpportunityDecision,
  serializeOpportunityEvaluation,
} from "@/lib/opportunities/evaluation/serialization";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_opportunity_evaluation", message } },
    { status: 400 },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid("Opportunity id is invalid.");

  try {
    const state = await loadOpportunityEvaluationState(id);
    return NextResponse.json({
      profileAvailable: state.profileAvailable,
      evaluation: serializeOpportunityEvaluation(state.evaluation),
      decision: serializeOpportunityDecision(state.decision),
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "opportunity_evaluation_unavailable",
          message: "Opportunity evaluation is temporarily unavailable.",
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
    return NextResponse.json({ evaluation: serializeOpportunityEvaluation(await runOpportunityEvaluation(id)) });
  } catch (error) {
    if (error instanceof OpportunityEvaluationPrerequisiteError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "opportunity_not_found" ? 404 : 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "opportunity_evaluation_failed",
          message: "Opportunity could not be evaluated.",
        },
      },
      { status: 503 },
    );
  }
}
