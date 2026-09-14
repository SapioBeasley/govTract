import type { SolicitationUnderstandingContent, SolicitationUnderstandingFinding } from "./types";

const findingSections = [
  "scope", "deliverables", "workBreakdown", "location", "schedule", "quantities",
  "qualifications", "insuranceBonding", "mandatoryEvents", "pricingInstructions",
  "submissionComponents", "evaluationCriteria", "disqualifiers", "questionsAmbiguities",
] as const;

function decodeFinding(
  finding: SolicitationUnderstandingFinding,
  allowedSourceSegmentIds: ReadonlySet<string>,
): SolicitationUnderstandingFinding {
  if (finding.key.startsWith("META::")) {
    return {
      ...finding,
      key: finding.key.slice(6).trim() || finding.key,
      details: { ...(finding.details ?? {}), sourceSegmentIds: [] },
    };
  }

  const prefixEnd = finding.key.indexOf("]::");
  if (finding.key.startsWith("SOURCE[") && prefixEnd >= 7) {
    const rawIds = finding.key.slice(7, prefixEnd);
    const stableKey = finding.key.slice(prefixEnd + 3).trim() || finding.key;
    const sourceSegmentIds = [...new Set(
      rawIds
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && allowedSourceSegmentIds.has(value)),
    )];

    return {
      ...finding,
      key: stableKey,
      details: { ...(finding.details ?? {}), sourceSegmentIds },
    };
  }

  if (allowedSourceSegmentIds.size === 1) {
    return {
      ...finding,
      details: {
        ...(finding.details ?? {}),
        sourceSegmentIds: [...allowedSourceSegmentIds],
      },
    };
  }

  return finding;
}

export function attachSourceSegmentCitations(
  content: SolicitationUnderstandingContent,
  allowedSourceSegmentIds: ReadonlySet<string>,
): SolicitationUnderstandingContent {
  const result: SolicitationUnderstandingContent = { ...content };
  for (const section of findingSections) {
    result[section] = content[section].map((finding) => decodeFinding(finding, allowedSourceSegmentIds));
  }
  return result;
}
