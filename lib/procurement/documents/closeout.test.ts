import assert from "node:assert/strict";
import test from "node:test";

import { decideCloseoutExistingExtraction } from "./closeout";

test("closeout reuses successful canonical extraction without downloading", () => {
  assert.equal(
    decideCloseoutExistingExtraction({ status: "extracted", retryFailed: false }),
    "reuse",
  );
  assert.equal(
    decideCloseoutExistingExtraction({ status: "truncated", retryFailed: false }),
    "reuse",
  );
});

test("closeout checkpoints failed extraction unless retry is explicitly enabled", () => {
  assert.equal(
    decideCloseoutExistingExtraction({ status: "failed", retryFailed: false }),
    "checkpoint_failed",
  );
  assert.equal(
    decideCloseoutExistingExtraction({ status: "failed", retryFailed: true }),
    "download",
  );
});

test("closeout downloads when canonical extraction is absent or incomplete", () => {
  assert.equal(
    decideCloseoutExistingExtraction({ status: null, retryFailed: false }),
    "download",
  );
  assert.equal(
    decideCloseoutExistingExtraction({ status: "pending", retryFailed: false }),
    "download",
  );
});
