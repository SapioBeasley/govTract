import { and, asc, eq, isNull } from "drizzle-orm";

import { closeDb, getDb } from "../lib/db/client";
import { solicitationUnderstandings } from "../lib/db/solicitation-understandings-schema";
import { opportunities } from "../lib/db/schema";
import { generateSolicitationUnderstanding } from "../lib/procurement/understanding/generation";
import { createGeminiUnderstandingProviderFromEnv } from "../lib/procurement/understanding/gemini";

const LIMIT = Math.max(0, Number(process.env.UNDERSTANDING_GENERATION_LIMIT ?? "25"));

async function main() {
  if (LIMIT === 0) {
    console.log(JSON.stringify({ eligible: 0, completed: 0, reused: 0, blocked: 0, failed: 0 }));
    return;
  }

  let provider;
  try {
    provider = createGeminiUnderstandingProviderFromEnv();
  } catch (error) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "provider_not_configured",
        detail: error instanceof Error ? error.message : "Gemini provider is not configured",
      }),
    );
    return;
  }

  const rows = await getDb()
    .select({ id: opportunities.id })
    .from(opportunities)
    .leftJoin(
      solicitationUnderstandings,
      eq(solicitationUnderstandings.opportunityId, opportunities.id),
    )
    .where(and(eq(opportunities.isActive, true), isNull(solicitationUnderstandings.id)))
    .orderBy(asc(opportunities.createdAt), asc(opportunities.id))
    .limit(LIMIT);

  const summary = {
    eligible: rows.length,
    completed: 0,
    reused: 0,
    blocked: 0,
    failed: 0,
    blockedReasons: {} as Record<string, number>,
  };

  for (const row of rows) {
    const result = await generateSolicitationUnderstanding({
      opportunityId: row.id,
      trigger: "automatic_initial",
      explicitManualUserAction: false,
      provider,
    });
    if (result.state === "completed") summary.completed += 1;
    else if (result.state === "reused") summary.reused += 1;
    else if (result.state === "failed") summary.failed += 1;
    else {
      summary.blocked += 1;
      summary.blockedReasons[result.reason] = (summary.blockedReasons[result.reason] ?? 0) + 1;
    }
  }

  console.log(JSON.stringify(summary));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
