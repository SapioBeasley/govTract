import { spawnSync } from "node:child_process";

import { discoverDeterministicTestFiles } from "./test-discovery";

async function main() {
  const testFiles = await discoverDeterministicTestFiles();

  if (testFiles.length === 0) {
    throw new Error("No deterministic test files were discovered.");
  }

  console.log(`Running ${testFiles.length} deterministic test files.`);

  const command = process.platform === "win32" ? "tsx.cmd" : "tsx";
  const result = spawnSync(
    command,
    ["--test", "--test-concurrency=1", ...testFiles],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Test runner terminated by signal ${result.signal}.`);
  }

  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error("Deterministic test suite failed to start:", error);
  process.exitCode = 1;
});
