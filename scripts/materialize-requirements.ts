import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { closeDb, getDb } from "../lib/db/client";
import { solicitationRequirements } from "../lib/db/solicitation-requirements-schema";
import { solicitationUnderstandings } from "../lib/db/solicitation-understandings-schema";
import { materializeRequirementsForUnderstanding } from "../lib/procurement/requirements/persistence";

const LIMIT = Math.max(0, Number(process.env.REQUIREMENTS_MATERIALIZATION_LIMIT ?? "100"));

async function main() {
  if (LIMIT === 0) {
    console.log(JSON.stringify({ eligible: 0, materialized: 0, requirements: 0, notReady: 0 }));
    return;
  }

  const rows = await getDb()
    .select({ id: solicitationUnderstandings.id })
    .from(solicitationUnderstandings)
    .leftJoin(
      solicitationRequirements,
      eq(solicitationRequirements.solicitationUnderstandingId, solicitationUnderstandings.id),
    )
    .where(
      and(
        eq(solicitationUnderstandings.status, "completed"),
        isNotNull(solicitationUnderstandings.structuredOutput),
        isNull(solicitationRequirements.id),
      ),
    )
    .orderBy(asc(solicitationUnderstandings.createdAt), asc(solicitationUnderstandings.id))
    .limit(LIMIT);

  const summary = { eligible: rows.length, materialized: 0, requirements: 0, notReady: 0 };
  for (const row of rows) {
    const result = await materializeRequirementsForUnderstanding(row.id);
    if (result.state === "materialized") {
      summary.materialized += 1;
      summary.requirements += result.requirementCount;
    } else {
      summary.notReady += 1;
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
