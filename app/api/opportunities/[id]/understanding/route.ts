import { NextResponse } from "next/server";

import { generateSolicitationUnderstanding } from "@/lib/procurement/understanding/generation";
import { loadLatestCompletedSolicitationUnderstanding } from "@/lib/procurement/understanding/read";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function publicUnderstanding(
  understanding: Awaited<ReturnType<typeof loadLatestCompletedSolicitationUnderstanding>>,
) {
  if (!understanding) return null;
  return {
    id: understanding.id,
    status: understanding.status,
    generationTrigger: understanding.generationTrigger,
    completenessStatus: understanding.completenessStatus,
    incompleteReason: understanding.incompleteReason,
    isStale: understanding.isStale,
    content: understanding.structuredOutput,
    createdAt: understanding.createdAt.toISOString(),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: { code: "invalid_opportunity_id" } }, { status: 400 });
  }

  try {
    const understanding = await loadLatestCompletedSolicitationUnderstanding(id);
    return NextResponse.json({ understanding: publicUnderstanding(understanding) });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "understanding_unavailable",
          message: "Solicitation understanding is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: { code: "invalid_opportunity_id" } }, { status: 400 });
  }

  try {
    const result = await generateSolicitationUnderstanding({
      opportunityId: id,
      trigger: "manual",
      explicitManualUserAction: true,
    });

    if (result.state === "completed" || result.state === "reused") {
      return NextResponse.json({ result });
    }

    if (result.state === "failed") {
      return NextResponse.json(
        {
          error: {
            code: result.reason,
            message: "The solicitation understanding run did not produce a usable result.",
          },
          understandingId: result.understandingId,
        },
        { status: 502 },
      );
    }

    const status = result.reason === "provider_not_configured" ? 503 : 409;
    const message =
      result.reason === "provider_not_configured"
        ? "Gemini solicitation understanding is not configured on this deployment."
        : result.reason === "budget_exceeded"
          ? "The current AI budget does not permit this Gemini call."
          : result.reason === "model_input_limit" || result.reason === "model_output_limit"
            ? "The configured model limits do not permit this understanding request."
            : result.reason === "no_usable_input"
              ? "There is not enough solicitation information to generate an understanding yet."
              : "Solicitation understanding cannot run in the current state.";

    return NextResponse.json(
      { error: { code: result.reason, message } },
      { status },
    );
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "understanding_generation_failed",
          message: "Solicitation understanding could not be generated.",
        },
      },
      { status: 500 },
    );
  }
}
