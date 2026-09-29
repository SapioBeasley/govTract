export type RequirementReadiness = {
  completenessStatus: "complete" | "partial";
  incompleteReasons: string[];
  isStale: boolean;
};

/**
 * A requirement set is safe to draft from when the understanding itself is current.
 * Evidence-only partiality is allowed because draft preparation independently verifies
 * every selected requirement has readable, pinned source evidence before model input.
 */
export function isSolicitationRequirementSetDraftable(
  requirements: RequirementReadiness | null | undefined,
) {
  if (!requirements || requirements.isStale) return false;
  if (requirements.completenessStatus === "complete") return true;
  return requirements.incompleteReasons.length > 0 &&
    requirements.incompleteReasons.every((reason) => reason === "requirement_evidence_missing");
}
