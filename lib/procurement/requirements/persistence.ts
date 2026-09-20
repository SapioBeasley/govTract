import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { documentExtractions, documentExtractionSegments, opportunityDocumentVersionExtractions } from "@/lib/db/document-extractions-schema";
import { opportunityDocumentVersions } from "@/lib/db/schema";
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

const MAX_EVIDENCE_EXCERPT_CHARS = 480;

/** Extract a bounded, verbatim passage from the referenced segment, favoring words in the requirement. */
function relevantSourcePassage(content: string, requirementText: string): string | null {
  if (!content.trim()) return null;
  const terms = new Set((requirementText.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => term.length >= 4));
  const windowSize = MAX_EVIDENCE_EXCERPT_CHARS;
  const step = Math.floor(windowSize / 2);
  let best = "";
  let bestScore = -1;
  for (let start = 0; start < content.length; start += step) {
    const passage = content.slice(start, start + windowSize).trim();
    if (!passage) continue;
    const found = new Set(passage.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const score = [...terms].filter((term) => found.has(term)).length;
    if (score > bestScore) {
      best = passage;
      bestScore = score;
    }
  }
  return best || null;
}

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
        .onConflictDoUpdate({
          target: [
            solicitationRequirements.solicitationUnderstandingId,
            solicitationRequirements.requirementKey,
          ],
          set: {
            requirementType: requirement.type,
            requirementLevel: requirement.level,
            text: requirement.text,
            sourceSection: requirement.sourceSection,
            sourceFindingKey: requirement.sourceFindingKey,
            details: requirement.details,
          },
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

  // Older understanding runs pinned the segment/version but left excerpt null.
  // Hydrate only from the exact extraction linked to that immutable document version,
  // and only when its extraction checksum matches the recorded document-version checksum.
  // This is a read-only deterministic recovery: do not regenerate AI understanding or
  // change the historic evidence record, which may outlive regenerable extraction text.
  const segmentIds = [...new Set(evidenceRows
    .filter((evidence) => !evidence.excerpt?.trim() && evidence.documentExtractionSegmentId)
    .map((evidence) => evidence.documentExtractionSegmentId as string))];
  const segmentRows = segmentIds.length === 0 ? [] : await db
    .select({
      id: documentExtractionSegments.id,
      content: documentExtractionSegments.content,
      versionId: opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
    })
    .from(documentExtractionSegments)
    .innerJoin(documentExtractions,
      eq(documentExtractions.id, documentExtractionSegments.documentExtractionId))
    .innerJoin(opportunityDocumentVersionExtractions,
      eq(opportunityDocumentVersionExtractions.documentExtractionId, documentExtractions.id))
    .innerJoin(opportunityDocumentVersions,
      eq(opportunityDocumentVersions.id, opportunityDocumentVersionExtractions.opportunityDocumentVersionId))
    .where(and(
      inArray(documentExtractionSegments.id, segmentIds),
      eq(documentExtractions.checksumSha256, opportunityDocumentVersions.checksumSha256),
    ));
  const sourceBySegmentAndVersion = new Map(segmentRows.map((segment) => [
    `${segment.id}:${segment.versionId}`, segment.content,
  ]));

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
    evidence: (evidenceByFinding.get(row.sourceFindingKey) ?? []).map((evidence) => ({
      ...evidence,
      excerpt: evidence.excerpt?.trim()
        ? evidence.excerpt
        : evidence.documentExtractionSegmentId
          ? relevantSourcePassage(
              sourceBySegmentAndVersion.get(
                `${evidence.documentExtractionSegmentId}:${evidence.opportunityDocumentVersionId}`,
              ) ?? "",
              row.text,
            )
          : null,
    })),
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
