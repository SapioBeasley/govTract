import assert from "node:assert/strict";
import test from "node:test";

import { decideExtractionQueueAction } from "./extraction-queue";

const checksum = "a".repeat(64);

test("reuses a completed canonical extraction without downloading again", () => {
  assert.deepEqual(
    decideExtractionQueueAction({
      extractionEnabled: true,
      checksumSha256: checksum,
      existingStatus: "extracted",
      retryFailed: false,
      backfillSlotsRemaining: 10,
      forceRehash: false,
    }),
    {
      download: false,
      attachExisting: true,
      consumesBackfillSlot: false,
      reason: "canonical_reuse",
    },
  );
});

test("bounds first-time backfill work", () => {
  assert.equal(
    decideExtractionQueueAction({
      extractionEnabled: true,
      checksumSha256: checksum,
      existingStatus: null,
      retryFailed: false,
      backfillSlotsRemaining: 0,
      forceRehash: false,
    }).reason,
    "backfill_limit",
  );
});

test("an interrupted pending extraction is safely resumed through backfill", () => {
  const decision = decideExtractionQueueAction({
    extractionEnabled: true,
    checksumSha256: checksum,
    existingStatus: "pending",
    retryFailed: false,
    backfillSlotsRemaining: 1,
    forceRehash: false,
  });
  assert.equal(decision.download, true);
  assert.equal(decision.consumesBackfillSlot, true);
  assert.equal(decision.reason, "backfill");
});

test("completed failures are checkpointed unless retry is requested", () => {
  const skipped = decideExtractionQueueAction({
    extractionEnabled: true,
    checksumSha256: checksum,
    existingStatus: "failed",
    retryFailed: false,
    backfillSlotsRemaining: 1,
    forceRehash: false,
  });
  assert.equal(skipped.reason, "previous_failure");
  assert.equal(skipped.download, false);
  assert.equal(skipped.attachExisting, true);

  const retry = decideExtractionQueueAction({
    extractionEnabled: true,
    checksumSha256: checksum,
    existingStatus: "failed",
    retryFailed: true,
    backfillSlotsRemaining: 1,
    forceRehash: false,
  });
  assert.equal(retry.reason, "backfill");
  assert.equal(retry.download, true);
});

test("new documents still download even when the backfill budget is exhausted", () => {
  const decision = decideExtractionQueueAction({
    extractionEnabled: true,
    checksumSha256: null,
    existingStatus: null,
    retryFailed: false,
    backfillSlotsRemaining: 0,
    forceRehash: false,
  });
  assert.equal(decision.reason, "new_or_unhashed");
  assert.equal(decision.download, true);
  assert.equal(decision.consumesBackfillSlot, false);
});
