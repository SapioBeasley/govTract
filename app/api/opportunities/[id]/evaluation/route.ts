import { NextResponse } from "next/server";

import {
  OpportunityEvaluationPrerequisiteError,
  loadOpportunityEvaluationState,
  runOpportunityEvaluation,
} from "@/lib/opportunities/evaluation/service";
import type {
  OpportunityDecisionRecord,
  OpportunityEvaluationRecord,
} from "@/lib/opportunities/evaluation/persistence";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export function publicEvaluation(evaluation: OpportunityEvaluationRecord | null) {
  if (!evaluation) return null;
  return {
    ...evaluation,
    evaluatedAt: evaluation.evaluatedAt.toISOString(),
    createdAt: evaluation.createdAt.toISOString(),
    updatedAt: evaluation.updatedAt.toISOString(),
  };
}

export function publicDecision(decision: OpportunityDecisionRecord | null) {
  if (!decision) return null;
  return {
    ...decision,
    decidedAt: decision.decidedAt.toISOString(),
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}

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
      evaluation: publicEvaluation(state.evaluation),
      decision: publicDecision(state.decision),
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
    return NextResponse.json({ evaluation: publicEvaluation(await runOpportunityEvaluation(id)) });
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
