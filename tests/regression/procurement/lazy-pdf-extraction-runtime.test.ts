import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "lib/procurement/documents/extract-content.ts"), "utf8");

test("pdf parser is lazy-loaded so non-PDF extraction does not require pdfjs canvas globals", () => {
  assert.doesNotMatch(source, /import\s+\{\s*PDFParse\s*\}\s+from\s+"pdf-parse"/);
  assert.match(source, /await import\("pdf-parse"\)/);
});
