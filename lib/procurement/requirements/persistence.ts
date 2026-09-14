import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { solicitationRequirements } from "@/lib/db/solicitation-requirements-schema";
import {
  solicitationUnderstandingEvidence,
  solicitationUnderstandings,
} from "@/lib/db/solicitation-understandings-schema";
import { deriveSolicitationRequirements } from "./derive";
import { isSolicitationUnderstandingContent } from "../understanding/types";

export type SolicitationRequirementEvidence = {
  opportunityDocumentVersionId: string;
  documentExtractionSegmentId: string | null;
  locator: Record<string, unknown>;
  excerpt: string | null;
};

export type PersistedSolicitationRequirement = {
  id: string;
  requirementKey: string;
  type: string;
  level: string;
  text: string;
  sourceSection: string;
  sourceFindingKey: string;
  details: Record<string, unknown>;
  evidence: SolicitationRequirementEvidence[];
};

export type SolicitationRequirementSet = {
  understandingId: string;
  completenessStatus: "complete" | "partial";
  incompleteReasons: string[];
  isStale: boolean;
  requirements: PersistedSolicitationRequirement[];
};

export async function materializeRequirementsForUnderstanding(understandingId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [understanding] = await tx
      .select({
        opportunityId: solicitationUnderstandings.opportunityId,
        status: solicitationUnderstandings.status,
        structuredOutput: solicitationUnderstandings.structuredOutput,
      })
      .from(solicitationUnderstandings)
      .where(eq(solicitationUnderstandings.id, understandingId))
      .limit(1);

    if (
      !understanding ||
      understanding.status !== "completed" ||
      !isSolicitationUnderstandingContent(understanding.structuredOutput)
    ) {
      return { state: "not_ready" as const, requirementCount: 0 };
    }

    const requirements = deriveSolicitationRequirements(understanding.structuredOutput);
    for (const requirement of requirements) {
      await tx
        .insert(solicitationRequirements)
        .values({
          opportunityId: understanding.opportunityId,
          solicitationUnderstandingId: understandingId,
          requirementKey: requirement.requirementKey,
          requirementType: requirement.type,
          requirementLevel: requirement.level,
          text: requirement.text,
          sourceSection: requirement.sourceSection,
          sourceFindingKey: requirement.sourceFindingKey,
          details: requirement.details,
        })
        .onConflictDoNothing({
          target: [
            solicitationRequirements.solicitationUnderstandingId,
            solicitationRequirements.requirementKey,
          ],
        });
    }

    const persisted = await tx
      .select({ id: solicitationRequirements.id })
      .from(solicitationRequirements)
      .where(eq(solicitationRequirements.solicitationUnderstandingId, understandingId));

    return { state: "materialized" as const, requirementCount: persisted.length };
  });
}

export async function loadLatestSolicitationRequirements(
  opportunityId: string,
): Promise<SolicitationRequirementSet | null> {
  const db = getDb();
  const [understanding] = await db
    .select({
      id: solicitationUnderstandings.id,
      completenessStatus: solicitationUnderstandings.completenessStatus,
      incompleteReason: solicitationUnderstandings.incompleteReason,
      isStale: solicitationUnderstandings.isStale,
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
  if (!understanding) return null;

  const rows = await db
    .select({
      id: solicitationRequirements.id,
      requirementKey: solicitationRequirements.requirementKey,
      type: solicitationRequirements.requirementType,
      level: solicitationRequirements.requirementLevel,
      text: solicitationRequirements.text,
      sourceSection: solicitationRequirements.sourceSection,
      sourceFindingKey: solicitationRequirements.sourceFindingKey,
      details: solicitationRequirements.details,
    })
    .from(solicitationRequirements)
    .where(eq(solicitationRequirements.solicitationUnderstandingId, understanding.id))
    .orderBy(asc(solicitationRequirements.requirementKey), asc(solicitationRequirements.id));

  const evidenceRows = await db
    .select({
      findingKey: solicitationUnderstandingEvidence.findingKey,
      opportunityDocumentVersionId: solicitationUnderstandingEvidence.opportunityDocumentVersionId,
      documentExtractionSegmentId: solicitationUnderstandingEvidence.documentExtractionSegmentId,
      locator: solicitationUnderstandingEvidence.locator,
      excerpt: solicitationUnderstandingEvidence.excerpt,
    })
    .from(solicitationUnderstandingEvidence)
    .where(eq(solicitationUnderstandingEvidence.solicitationUnderstandingId, understanding.id))
    .orderBy(
      asc(solicitationUnderstandingEvidence.findingKey),
      asc(solicitationUnderstandingEvidence.opportunityDocumentVersionId),
      asc(solicitationUnderstandingEvidence.id),
    );

  const evidenceByFinding = new Map<string, SolicitationRequirementEvidence[]>();
  for (const evidence of evidenceRows) {
    const list = evidenceByFinding.get(evidence.findingKey) ?? [];
    list.push({
      opportunityDocumentVersionId: evidence.opportunityDocumentVersionId,
      documentExtractionSegmentId: evidence.documentExtractionSegmentId,
      locator: evidence.locator,
      excerpt: evidence.excerpt,
    });
    evidenceByFinding.set(evidence.findingKey, list);
  }

  const requirements = rows.map((row) => ({
    ...row,
    evidence: evidenceByFinding.get(row.sourceFindingKey) ?? [],
  }));
  const incompleteReasons = new Set<string>();
  if (understanding.incompleteReason) incompleteReasons.add(understanding.incompleteReason);
  if (requirements.some((requirement) => requirement.evidence.length === 0)) {
    incompleteReasons.add("requirement_evidence_missing");
  }

  return {
    understandingId: understanding.id,
    completenessStatus:
      understanding.completenessStatus === "partial" || incompleteReasons.size > 0
        ? "partial"
        : "complete",
    incompleteReasons: [...incompleteReasons],
    isStale: understanding.isStale,
    requirements,
  };
}
