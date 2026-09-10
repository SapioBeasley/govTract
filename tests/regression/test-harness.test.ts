import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRepoFile(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("package exposes one aggregate deterministic test command", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.test, "tsx scripts/run-tests.ts");
});

test("PR validation watches repository tests and uses the aggregate test command", async () => {
  const workflow = await readRepoFile(".github/workflows/pr-validation.yml");

  assert.match(workflow, /- "tests\/\*\*"/);
  assert.match(workflow, /run: npm test/);
});

test("PR validation provisions isolated PostgreSQL and applies migrations before tests", async () => {
  const workflow = await readRepoFile(".github/workflows/pr-validation.yml");

  assert.match(workflow, /services:\s*[\s\S]*postgres:/);
  assert.match(workflow, /POSTGRES_DB:\s*govtract_test/);
  assert.match(workflow, /DATABASE_URL:\s*postgresql:\/\//);
  assert.match(workflow, /SOURCE_SESSION_ENCRYPTION_KEY:/);

  const migrateIndex = workflow.indexOf("run: npm run db:migrate");
  const testIndex = workflow.indexOf("run: npm test");
  assert.ok(migrateIndex >= 0, "migration step must exist");
  assert.ok(testIndex >= 0, "aggregate test step must exist");
  assert.ok(migrateIndex < testIndex, "migrations must run before tests");
});
