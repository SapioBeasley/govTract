import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSourceOpportunityLifecycle,
  selectCanonicalOpportunityLifecycle,
} from "./opportunity";

test("source disappearance becomes inactive_unknown without inventing a terminal outcome", () => {
  assert.deepEqual(
    deriveSourceOpportunityLifecycle({
      sourceRecordActive: false,
      status: "open",
      sourceStatus: "published",
    }),
    { state: "inactive_unknown", terminalEvidence: null },
  );
});

test("explicit source terminal statuses normalize independently from source presence", () => {
  assert.deepEqual(
    deriveSourceOpportunityLifecycle({
      sourceRecordActive: true,
      status: "open",
      sourceStatus: "Canceled",
    }),
    { state: "cancelled", terminalEvidence: "sourceStatus" },
  );
  assert.deepEqual(
    deriveSourceOpportunityLifecycle({
      sourceRecordActive: false,
      status: "Awarded",
      sourceStatus: null,
    }),
    { state: "awarded", terminalEvidence: "status" },
  );
  assert.deepEqual(
    deriveSourceOpportunityLifecycle({
      sourceRecordActive: true,
      status: "closed",
      sourceStatus: null,
    }),
    { state: "closed", terminalEvidence: "status" },
  );
});

test("one currently active non-terminal source keeps a cross-source opportunity active", () => {
  const result = selectCanonicalOpportunityLifecycle([
    {
      source: "beacon",
      sourceRecordId: "beacon-1",
      sourceRecordActive: false,
      authority: "authoritative",
      isPrimary: true,
      status: "open",
      sourceStatus: "approved",
    },
    {
      source: "bidnet",
      sourceRecordId: "bidnet-1",
      sourceRecordActive: true,
      authority: "aggregator",
      isPrimary: false,
      status: "open",
      sourceStatus: "published",
    },
  ]);

  assert.equal(result.state, "active");
  assert.equal(result.evidence.kind, "active_source");
  assert.equal(result.evidence.source, "bidnet");
});

test("terminal evidence is retained when every linked source disappears", () => {
  const result = selectCanonicalOpportunityLifecycle([
    {
      source: "beacon",
      sourceRecordId: "beacon-2",
      sourceRecordActive: false,
      authority: "authoritative",
      isPrimary: true,
      status: "open",
      sourceStatus: "awarded",
    },
    {
      source: "bidnet",
      sourceRecordId: "bidnet-2",
      sourceRecordActive: false,
      authority: "aggregator",
      isPrimary: false,
      status: "open",
      sourceStatus: "closed",
    },
  ]);

  assert.equal(result.state, "awarded");
  assert.equal(result.evidence.kind, "terminal_status");
  assert.equal(result.evidence.source, "beacon");
  assert.equal(result.evidence.field, "sourceStatus");
});

test("authoritative terminal evidence outranks a lower-authority source that still appears active", () => {
  const result = selectCanonicalOpportunityLifecycle([
    {
      source: "beacon",
      sourceRecordId: "beacon-awarded",
      sourceRecordActive: true,
      authority: "authoritative",
      isPrimary: true,
      status: "open",
      sourceStatus: "awarded",
    },
    {
      source: "bidnet",
      sourceRecordId: "bidnet-open-copy",
      sourceRecordActive: true,
      authority: "aggregator",
      isPrimary: false,
      status: "open",
      sourceStatus: "published",
    },
  ]);

  assert.equal(result.state, "awarded");
  assert.equal(result.evidence.kind, "terminal_status");
  assert.equal(result.evidence.source, "beacon");
});
