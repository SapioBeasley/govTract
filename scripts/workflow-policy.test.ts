import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("Beacon operational ingestion is not triggered by ordinary pull requests", async () => {
  const content = await workflow(".github/workflows/beacon-discovery.yml");

  assert.match(content, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(content, /^\s{2}pull_request:\s*$/m);
});
