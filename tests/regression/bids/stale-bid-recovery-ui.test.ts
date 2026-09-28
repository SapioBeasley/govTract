import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("stale bid source collapses builder into one recovery state", () => {
  const page = read("app/bids/[id]/page.tsx");
  const outline = read("components/bid-outline-control.tsx");
  assert.match(page, /needsSourceRecovery=/);
  assert.match(page, /historicalRequirementCount=/);
  assert.match(outline, /Bid needs to be refreshed/);
  assert.match(outline, /Refresh bid from current solicitation/);
  assert.match(outline, /Your saved response text will be preserved/);
  assert.match(outline, /needsSourceRecovery \? \(/);
  assert.match(outline, /historicalRequirementCount/);
  assert.doesNotMatch(outline, /You may prepare an outline/);
});

test("source recovery points to the existing deterministic reconciliation control", () => {
  const outline = read("components/bid-outline-control.tsx");
  const sourceAction = read("components/bid-source-reconciliation-action.tsx");
  assert.match(outline, /href="#source-reconciliation"/);
  assert.match(sourceAction, /id="source-reconciliation"/);
  assert.match(sourceAction, /Reconcile reviewed source and outline \(no AI call\)/);
});
