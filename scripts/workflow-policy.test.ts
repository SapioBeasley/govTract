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
  assert.match(content, /PURSUIT_SNAPSHOT_LIMIT:\s*\$\{\{ inputs\.pursuit_snapshot_limit \|\| '10' \}\}/);
  assert.match(content, /PURSUIT_SNAPSHOT_SOURCE:\s*"beacon"/);
  assert.match(content, /VERCEL_ORG_ID:\s*team_PICVswifAiV6qP9Xx4JPAmYW/);
  assert.match(content, /VERCEL_PROJECT_ID:\s*prj_83ZjVMpv1j12g03SO0eirVjhkEOT/);
  assert.doesNotMatch(content, /BLOB_READ_WRITE_TOKEN/);
  assert.match(content, /VERCEL_TOKEN:\s*\$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.doesNotMatch(content, /vercel@59\.17\.0 link/);
  assert.doesNotMatch(content, /vercel@59\.17\.0 env run/);
  assert.match(
    content,
    /https:\/\/api\.vercel\.com\/v3\/env\/pull\/\$\{VERCEL_PROJECT_ID\}\/production\?source=govtract-github-actions/,
  );
  assert.doesNotMatch(
    content,
    /https:\/\/api\.vercel\.com\/v1\/projects\/\$\{VERCEL_PROJECT_ID\}\/token/,
  );
  assert.doesNotMatch(
    content,
    /https:\/\/api\.vercel\.com\/v10\/projects\/\$\{VERCEL_PROJECT_ID\}\/env/,
  );
  assert.match(content, /body\?\.env\?\.VERCEL_OIDC_TOKEN/);
  assert.match(content, /body\?\.env\?\.BLOB_STORE_ID/);
  assert.match(content, /Authorization: Bearer \$VERCEL_TOKEN/);
  assert.match(content, /::add-mask::\$VERCEL_OIDC_TOKEN/);
  assert.match(content, /unset VERCEL_TOKEN/);
  assert.match(content, /export VERCEL_OIDC_TOKEN BLOB_STORE_ID/);
  assert.match(content, /npm run pursuit:snapshots/);
  assert.match(content, /github\.event_name == 'schedule' \|\| inputs\.persist/);
  assert.match(content, /github\.event_name == 'schedule' \|\| inputs\.generate_understandings/);
  assert.doesNotMatch(content, /^\s{2}pull_request:\s*$/m);
  assert.doesNotMatch(content, /npm run typecheck/);
  assert.doesNotMatch(content, /npm run test:/);
});

test("one-time Understanding rollout backfill is merge-marker gated and bounded", async () => {
  const content = await workflow(".github/workflows/understanding-rollout-backfill.yml");

  assert.match(content, /^\s{2}push:\s*$/m);
  assert.match(content, /branches:\s*\[main\]/);
  assert.match(
    content,
    /contains\(github\.event\.head_commit\.message, '\[understanding-rollout-backfill\]'\)/,
  );
  assert.match(content, /GOVTRACT_AI_AUTOMATIC_BUDGET_USD:\s*"0\.25"/);
  assert.match(content, /UNDERSTANDING_GENERATION_LIMIT:\s*"50"/);
  assert.match(content, /REQUIREMENTS_MATERIALIZATION_REFRESH:\s*"true"/);
  assert.match(content, /npm run requirements:materialize/);
  assert.match(content, /npm run understand:opportunities/);
  assert.doesNotMatch(content, /^\s{2}schedule:\s*$/m);
  assert.doesNotMatch(content, /^\s{2}pull_request:\s*$/m);
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
