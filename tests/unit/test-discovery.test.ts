import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverDeterministicTestFiles } from "../../scripts/test-discovery";

test("discovers co-located and repository tests without manual registration", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "govtract-test-discovery-"));

  try {
    await Promise.all([
      mkdir(join(cwd, "app", "feature"), { recursive: true }),
      mkdir(join(cwd, "components"), { recursive: true }),
      mkdir(join(cwd, "lib", "domain"), { recursive: true }),
      mkdir(join(cwd, "scripts"), { recursive: true }),
      mkdir(join(cwd, "tests", "regression"), { recursive: true }),
      mkdir(join(cwd, "node_modules", "ignored"), { recursive: true }),
    ]);

    await Promise.all([
      writeFile(join(cwd, "app", "feature", "route.test.ts"), ""),
      writeFile(join(cwd, "components", "card.test.tsx"), ""),
      writeFile(join(cwd, "lib", "domain", "identity.test.ts"), ""),
      writeFile(join(cwd, "scripts", "migration.test.ts"), ""),
      writeFile(join(cwd, "tests", "regression", "feed.test.ts"), ""),
      writeFile(join(cwd, "lib", "domain", "identity.ts"), ""),
      writeFile(join(cwd, "node_modules", "ignored", "dependency.test.ts"), ""),
    ]);

    assert.deepEqual(await discoverDeterministicTestFiles(cwd), [
      "app/feature/route.test.ts",
      "components/card.test.tsx",
      "lib/domain/identity.test.ts",
      "scripts/migration.test.ts",
      "tests/regression/feed.test.ts",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
