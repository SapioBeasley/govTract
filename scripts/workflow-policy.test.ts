import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function workflow(path: string) {
  return readFile(path, "utf8");
}

test("PR validation reserves hosted runners for non-draft PRs or explicit manual validation", async () => {
  const content = await workflow(".github/workflows/pr-validation.yml");

  assert.match(content, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(
    content,
    /^\s{4}types:\s*\[opened, reopened, synchronize, ready_for_review\]\s*$/m,
  );
  assert.match(
    content,
    /^\s{4}if:\s*>-\s*\n\s{6}github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.draft == false\s*$/m,
  );
  assert.match(content, /^\s{2}cancel-in-progress:\s*true\s*$/m);
});

test("Beacon operational ingestion runs on a bounded schedule without becoming PR CI", async () => {
  const content = await workflow(".github/workflows/beacon-discovery.yml");

  assert.match(content, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(content, /^\s{2}schedule:\s*$/m);
  assert.match(content, /^\s{6}- cron:\s*"17 0,12 \* \* \*"\s*$/m);
  assert.match(content, /GOVTRACT_AI_AUTOMATIC_BUDGET_USD:\s*"0\.25"/);
  assert.match(content, /github\.event_name == 'schedule' \|\| inputs\.persist/);
  assert.match(content, /github\.event_name == 'schedule' \|\| inputs\.generate_understandings/);
  assert.doesNotMatch(content, /^\s{2}pull_request:\s*$/m);
  assert.doesNotMatch(content, /npm run typecheck/);
  assert.doesNotMatch(content, /npm run test:/);
});

test("production database migration runs only migration work after merge", async () => {
  const content = await workflow(".github/workflows/db-migrate.yml");

  assert.doesNotMatch(content, /^\s{6}- "package\.json"\s*$/m);
  assert.doesNotMatch(content, /npm run typecheck/);
  assert.doesNotMatch(content, /npm run test:db-migrations/);
  assert.match(content, /npm run db:migrate -- --baseline-existing/);
});

test("temporary issue-specific route probe workflow has been removed", async () => {
  const files = await readdir(".github/workflows");
  assert.ok(!files.includes("issue-69-route-probe.yml"));
});
