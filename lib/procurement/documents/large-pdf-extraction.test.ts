import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractPdfContentFromPath,
  extractPdfPagesInBatches,
} from "./extract-content";
import { collectDocumentStreamForExtraction } from "./streamed-extraction-source";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(texts: string[]) {
  const pageObjectNumbers = texts.map((_, index) => 3 + index * 2);
  const contentObjectNumbers = texts.map((_, index) => 4 + index * 2);
  const fontObjectNumber = 3 + texts.length * 2;
  const objects: string[] = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${texts.length} >>`;

  texts.forEach((text, index) => {
    const pageObject = pageObjectNumbers[index];
    const contentObject = contentObjectNumbers[index];
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontObjectNumber] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = new Array<number>(objects.length).fill(0);
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(pdf, "latin1");
    pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let number = 1; number < objects.length; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function* chunks(...values: Buffer[]) {
  for (const value of values) yield value;
}

test("large PDF stream spills to a temporary file instead of failing the memory threshold", async () => {
  const first = Buffer.from("01234567", "utf8");
  const second = Buffer.from("89abcdef", "utf8");
  const expected = Buffer.concat([first, second]);
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-stream-test-"));

  try {
    const collected = await collectDocumentStreamForExtraction({
      chunks: chunks(first, second),
      maxBufferBytes: 8,
      maxSourceBytes: 64,
      spoolToDisk: true,
      tempRoot,
    });

    assert.equal(collected.bytesRead, expected.length);
    assert.equal(collected.buffer, null);
    assert.equal(collected.exceededBufferLimit, true);
    assert.ok(collected.filePath);
    assert.deepEqual(await readFile(collected.filePath), expected);
    assert.equal(
      collected.checksumSha256,
      createHash("sha256").update(expected).digest("hex"),
    );

    await collected.cleanup();
    await assert.rejects(readFile(collected.filePath));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("file-backed PDF extraction preserves page order and provenance in bounded page batches", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-pdf-test-"));
  const path = join(tempRoot, "large.pdf");
  await writeFile(path, buildPdf(["page one", "page two", "page three"]));

  try {
    const extraction = await extractPdfContentFromPath(path, { pageBatchSize: 1 });

    assert.equal(extraction.kind, "pdf");
    assert.equal(extraction.metadata.totalPages, 3);
    assert.equal(extraction.metadata.extractionMode, "file_page_batches");
    assert.equal(extraction.metadata.pageBatchSize, 1);
    assert.deepEqual(extraction.metadata.failedPages, []);
    assert.deepEqual(extraction.segments.map((segment) => segment.locator?.page), [1, 2, 3]);
    assert.match(extraction.segments[0].content, /page one/);
    assert.match(extraction.segments[2].content, /page three/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("page-batch extraction isolates a bad page without discarding usable pages", async () => {
  const result = await extractPdfPagesInBatches({
    totalPages: 3,
    batchSize: 2,
    extractPages: async (pages) => {
      if (pages.includes(2)) throw new Error("synthetic page failure");
      return pages.map((page) => ({ page, text: `page ${page}` }));
    },
  });

  assert.deepEqual(result.failedPages, [2]);
  assert.deepEqual(result.pages, [
    { page: 1, text: "page 1" },
    { page: 3, text: "page 3" },
  ]);
  assert.equal(result.partial, true);
});
