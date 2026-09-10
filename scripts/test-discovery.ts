import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const TEST_ROOTS = ["app", "components", "lib", "scripts", "tests"] as const;
const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx)$/;

async function walkTests(root: string, current: string, files: string[]) {
  let entries;

  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = resolve(current, entry.name);

    if (entry.isDirectory()) {
      await walkTests(root, absolutePath, files);
      continue;
    }

    if (!entry.isFile() || !TEST_FILE_PATTERN.test(entry.name)) continue;

    files.push(relative(root, absolutePath).split(sep).join("/"));
  }
}

export async function discoverDeterministicTestFiles(cwd = process.cwd()) {
  const files: string[] = [];

  for (const testRoot of TEST_ROOTS) {
    await walkTests(cwd, resolve(cwd, testRoot), files);
  }

  return files.sort((left, right) => left.localeCompare(right, "en"));
}
