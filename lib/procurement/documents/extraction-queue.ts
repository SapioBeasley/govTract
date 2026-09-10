export type CanonicalExtractionStatus =
  | "pending"
  | "extracted"
  | "failed"
  | "truncated";

export type ExtractionQueueDecision = {
  download: boolean;
  attachExisting: boolean;
  consumesBackfillSlot: boolean;
  reason:
    | "new_or_unhashed"
    | "hash_only"
    | "canonical_reuse"
    | "previous_failure"
    | "backfill"
    | "backfill_limit";
};

export function decideExtractionQueueAction(input: {
  extractionEnabled: boolean;
  checksumSha256: string | null;
  existingStatus: CanonicalExtractionStatus | null;
  retryFailed: boolean;
  backfillSlotsRemaining: number;
  forceRehash: boolean;
}): ExtractionQueueDecision {
  const hasChecksum = Boolean(input.checksumSha256);

  if (!input.extractionEnabled) {
    if (hasChecksum && !input.forceRehash) {
      return {
        download: false,
        attachExisting: false,
        consumesBackfillSlot: false,
        reason: "hash_only",
      };
    }

    return {
      download: true,
      attachExisting: false,
      consumesBackfillSlot: false,
      reason: "new_or_unhashed",
    };
  }

  if (hasChecksum && !input.forceRehash) {
    if (input.existingStatus === "extracted" || input.existingStatus === "truncated") {
      return {
        download: false,
        attachExisting: true,
        consumesBackfillSlot: false,
        reason: "canonical_reuse",
      };
    }

    if (input.existingStatus === "failed" && !input.retryFailed) {
      return {
        download: false,
        attachExisting: true,
        consumesBackfillSlot: false,
        reason: "previous_failure",
      };
    }

    if (input.backfillSlotsRemaining <= 0) {
      return {
        download: false,
        attachExisting: false,
        consumesBackfillSlot: false,
        reason: "backfill_limit",
      };
    }

    return {
      download: true,
      attachExisting: false,
      consumesBackfillSlot: true,
      reason: "backfill",
    };
  }

  return {
    download: true,
    attachExisting: false,
    consumesBackfillSlot: false,
    reason: "new_or_unhashed",
  };
}
