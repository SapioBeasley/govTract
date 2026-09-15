import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSourceOpportunityLifecycle,
  isOpportunityLifecycleActive,
} from "../../lifecycle/opportunity";
import { parseBeaconRenderedLifecycle } from "./lifecycle";

test("Beacon rendered Pending Award is recognized as authoritative post-open lifecycle evidence", () => {
  const parsed = parseBeaconRenderedLifecycle(`
    City of Houston
    Spreadsheet Server
    PENDING AWARD
    Bid Details
  `);

  assert.deepEqual(parsed, {
    state: "pending_award",
    sourceStatus: "PENDING AWARD",
    evidenceText: "PENDING AWARD",
  });

  const lifecycle = deriveSourceOpportunityLifecycle({
    sourceRecordActive: true,
    status: "open",
    sourceStatus: parsed?.sourceStatus,
  });
  assert.deepEqual(lifecycle, {
    state: "pending_award",
    terminalEvidence: "sourceStatus",
  });
  assert.equal(isOpportunityLifecycleActive(lifecycle.state), false);
});

test("Beacon rendered lifecycle parser handles awarded, cancelled, and closed labels", () => {
  assert.equal(parseBeaconRenderedLifecycle("Awarded\nSupplier details")?.state, "awarded");
  assert.equal(parseBeaconRenderedLifecycle("CANCELED\nNotice")?.state, "cancelled");
  assert.equal(parseBeaconRenderedLifecycle("Closed\nBid results")?.state, "closed");
});

test("Beacon rendered lifecycle parser does not infer terminal state from unrelated award language", () => {
  assert.equal(
    parseBeaconRenderedLifecycle(`
      Open Solicitation
      Evaluation and award criteria
      The City reserves the right to make an award.
    `),
    null,
  );
});
