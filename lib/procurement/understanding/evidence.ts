import { isSolicitationUnderstandingContent, type SolicitationUnderstandingContent } from "./types";

const findingSections = [
  "scope",
  "deliverables",
  "workBreakdown",
  "location",
  "schedule",
  "quantities",
  "qualifications",
  "insuranceBonding",
  "mandatoryEvents",
  "pricingInstructions",
  "submissionComponents",
  "evaluationCriteria",
  "disqualifiers",
  "questionsAmbiguities",
] as const;

export type UnderstandingEvidenceChunk = {
  documentVersionId: string;
  chunkKey: string;
  structuredOutput: unknown;
};

export type UnderstandingEvidenceReference = {
  findingKey: string;
  opportunityDocumentVersionId: string;
  documentExtractionSegmentId: string;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function segmentIdFromChunkKey(chunkKey: string) {
  const parts = chunkKey.split(":");
  if (parts[1] === "pack") return null;
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

function citedSegmentIds(details: Record<string, unknown> | undefined) {
  const value = details?.sourceSegmentIds;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
}

export function buildUnderstandingEvidenceReferences(input: {
  content: SolicitationUnderstandingContent;
  chunks: UnderstandingEvidenceChunk[];
}): UnderstandingEvidenceReference[] {
  const references: UnderstandingEvidenceReference[] = [];
  const seen = new Set<string>();

  for (const section of findingSections) {
    for (const finding of input.content[section]) {
      const target = normalizeText(finding.text);
      if (!target) continue;

      for (const chunk of input.chunks) {
        if (!isSolicitationUnderstandingContent(chunk.structuredOutput)) continue;
        const candidates = chunk.structuredOutput[section].filter(
          (candidate) => normalizeText(candidate.text) === target,
        );
        if (candidates.length === 0) continue;

        for (const candidate of candidates) {
          const segmentIds = citedSegmentIds(candidate.details);
          const fallbackSegmentId = segmentIdFromChunkKey(chunk.chunkKey);
          const resolvedSegmentIds = segmentIds.length > 0
            ? segmentIds
            : fallbackSegmentId
              ? [fallbackSegmentId]
              : [];

          for (const segmentId of resolvedSegmentIds) {
            const dedupeKey = `${finding.key}\0${chunk.documentVersionId}\0${segmentId}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            references.push({
              findingKey: finding.key,
              opportunityDocumentVersionId: chunk.documentVersionId,
              documentExtractionSegmentId: segmentId,
            });
          }
        }
      }
    }
  }

  return references.sort(
    (a, b) =>
      a.findingKey.localeCompare(b.findingKey) ||
      a.opportunityDocumentVersionId.localeCompare(b.opportunityDocumentVersionId) ||
      a.documentExtractionSegmentId.localeCompare(b.documentExtractionSegmentId),
  );
}
