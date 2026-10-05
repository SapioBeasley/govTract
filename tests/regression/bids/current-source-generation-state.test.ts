import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("a completed replacement snapshot clears the persisted stale marker only when its fingerprint is current", () => {
  const snapshot = read("lib/procurement/pursuits/snapshot.ts");
  assert.match(snapshot, /clearStale/);
  assert.match(snapshot, /currentDocumentSetFingerprint/);
  assert.match(snapshot, /snapshot\.documentSetFingerprint/);
  assert.match(snapshot, /status === "complete"/);
});

test("explicit Draft bid recovers deterministic extraction and stale understanding before drafting", () => {
  const route = read("app/api/bids/[id]/draft/route.ts");
  assert.match(route, /ensureStoredSnapshotExtractions/);
  assert.match(route, /generateSolicitationUnderstanding/);
  assert.match(route, /trigger:\s*"manual"/);
  assert.match(route, /explicitManualUserAction:\s*true/);
  assert.match(route, /materializeRequirementsForUnderstanding/);
  assert.match(route, /generateFullBidDraft/);
});

test("Draft bid can explicitly refresh retained understanding without losing saved responses", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");
  assert.match(page, /generationActionReady/);
  assert.match(page, /requiresUnderstandingRefresh/);
  assert.match(control, /requiresUnderstandingRefresh/);
  assert.match(control, /retained solicitation understanding will be refreshed first if required/i);
  assert.match(control, /saved bidder facts and exceptions will be preserved/i);
});
