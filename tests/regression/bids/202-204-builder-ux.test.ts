import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid builder exposes persistent save state and deterministic progress summary", () => {
  const outline = read("components/bid-outline-control.tsx");
  assert.match(outline, /saveStateLabel\(saveState\)/);
  assert.match(outline, /Unsaved changes|deriveSaveState/);
  assert.match(outline, /drafts saved/);
  assert.match(outline, /requirements addressed/);
  assert.match(outline, /source checks remaining/);
  assert.match(outline, /Next action:/);
  assert.match(outline, /final-review blockers/);
});

test("requirement cards use explicit user-facing states and keep technical controls advanced", () => {
  const row = read("components/compliance-matrix-control.tsx");
  assert.match(row, /Addressed in bid/);
  assert.match(row, /Check original buyer instruction/);
  assert.match(row, /Original source and other options/);
  assert.match(row, /border-emerald-300 bg-emerald-50/);
  assert.match(row, /border-amber-300 bg-amber-50/);
  assert.match(row, /border-blue-300 bg-blue-50/);
  assert.match(row, /Complete and confirm the original form/);
  assert.doesNotMatch(row, /complete: "Complete — addressed in my bid"/);
});
