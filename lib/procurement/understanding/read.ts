import { and, desc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { solicitationUnderstandings } from "@/lib/db/solicitation-understandings-schema";

import type {
  UnderstandingGenerationTrigger,
  UnderstandingIncompleteReason,
} from "./planning";
import { isSolicitationUnderstandingContent } from "./types";

export async function loadLatestCompletedSolicitationUnderstanding(opportunityId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: solicitationUnderstandings.id,
      opportunityId: solicitationUnderstandings.opportunityId,
      generationTrigger: solicitationUnderstandings.generationTrigger,
      status: solicitationUnderstandings.status,
      completenessStatus: solicitationUnderstandings.completenessStatus,
      incompleteReason: solicitationUnderstandings.incompleteReason,
      isStale: solicitationUnderstandings.isStale,
      structuredOutput: solicitationUnderstandings.structuredOutput,
      createdAt: solicitationUnderstandings.createdAt,
    })
    .from(solicitationUnderstandings)
    .where(
      and(
        eq(solicitationUnderstandings.opportunityId, opportunityId),
        eq(solicitationUnderstandings.status, "completed"),
        isNotNull(solicitationUnderstandings.structuredOutput),
      ),
    )
    .orderBy(desc(solicitationUnderstandings.createdAt), desc(solicitationUnderstandings.id))
    .limit(1);

  if (!row || !isSolicitationUnderstandingContent(row.structuredOutput)) return null;
  return {
    ...row,
    generationTrigger: row.generationTrigger as UnderstandingGenerationTrigger,
    completenessStatus: row.completenessStatus as "complete" | "partial",
    incompleteReason: row.incompleteReason as UnderstandingIncompleteReason | null,
    structuredOutput: row.structuredOutput,
  };
}
