/**
 * One active task per buyer ask. Source verification and bidder coverage remain
 * independent: a saved draft or a historical Complete never implies a current proof.
 */
export function nextRequirementAction(
  requirement: {
    canMarkComplete: boolean;
    effectiveStatus: string;
    requirementType: string;
    status: string;
  },
  context: {
    snapshotCurrent: boolean;
    understandingCurrent: boolean;
    sourceReady: boolean;
    matchingResponseReady: boolean;
    originalFormConfirmed: boolean;
  },
): { kind: "source" | "response" | "form" | "confirm" | "done"; title: string; detail: string } {
  if (!context.snapshotCurrent || !context.understandingCurrent ||
      !context.sourceReady || !requirement.canMarkComplete) {
    return {
      kind: "source",
      title: "1. Verify the buyer's requirement",
      detail: "Confirm what the current original asks before marking your response addressed.",
    };
  }
  if (requirement.requirementType === "form" && !context.originalFormConfirmed) {
    return {
      kind: "form",
      title: "2. Complete the buyer's original form",
      detail: "Fill out the original form and confirm it in Final review. A draft paragraph cannot replace it.",
    };
  }
  if (requirement.requirementType !== "form" && !context.matchingResponseReady) {
    return {
      kind: "response",
      title: "2. Write and save your response",
      detail: "Address this requirement in the response section above, then save your changes.",
    };
  }
  if (requirement.effectiveStatus === "complete") {
    return {
      kind: "done",
      title: "Addressed in your saved bid",
      detail: "Your review is recorded for the current source and saved response. Edits may require another review.",
    };
  }
  return {
    kind: "confirm",
    title: "3. Confirm your saved response covers this",
    detail: "Read your response and confirm it accurately describes what you will supply. A buyer request alone is not proof of your offer.",
  };
}
