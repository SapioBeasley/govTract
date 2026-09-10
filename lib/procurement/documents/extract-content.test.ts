import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "@e965/xlsx";

import {
  extractDocumentContent,
  getDocumentExtractorDescriptor,
  UnsupportedDocumentExtractionError,
} from "./extract-content";

const DOCX_FIXTURE_BASE64 =
  "UEsDBBQAAAAIAFm5KV0XmADX6wAAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU4DMQy98xWRr2gmAweEUKc9sByBQ/kAK/HMRM2mOC3t3+NpoQdUONpvs99itQ9e7aiwS7GHm7YDRdEk6+LYw8f6pbkHxRWjRZ8i9XAghtXyarE+ZGIl4sg9TLXmB63ZTBSQ25QpCjKkErDKWEad0WxwJH3bdXfapFgp1qbOHiBmTzTg1lf1vJf96ZJCnkE9nphzWA+Ys3cGq+B6F+2vmOY7ohXlkcOTy3wtBNCXI2bo74Qf4ZuUU5wl9Y6lvmIQmv5MxWqbzDaItP3f58KlaRicobN+dsslGWKW1oNvz0hAF88f6GPlyy9QSwMEFAAAAAgAWbkpXT+t/vqvAAAALAEAAAsAAABfcmVscy8ucmVsc43POw7CMAwA0J1TRN5pWgaEUEMXhNQVlQNEiZtWNB/F4dPbk4EBKgZG/57tunnaid0x0uidgKoogaFTXo/OCLh0p/UOGCXptJy8QwEzEjSHVX3GSaY8Q8MYiGXEkYAhpbDnnNSAVlLhA7pc6X20MuUwGh6kukqDfFOWWx4/DVigrNUCYqsrYN0c8B/c9/2o8OjVzaJLP3YsOrIso8Ek4OGj5vqdLjILPJ/Dv548vABQSwMEFAAAAAgAWbkpXT+UT66zAAAA6QAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWOQW/CMAyF7/yKKHdIx2GaqrYchthxOzCJa0gMVGrsyvYo/Pslkbh89nu2nt3tHmkyd2AZCXv7tmmsAQwUR7z29vd4WH9YI+ox+okQevsEsbth1S1tpPCXANXkBJR26e1NdW6dk3CD5GVDM2CeXYiT1yz56hbiODMFEMkH0uS2TfPukh/R1swzxeeQ61zABTp80f3IPqjZf3+ejMJDO1f8Qq6s2wJBf9hVo8asSvd6cvgHUEsBAhQDFAAAAAgAWbkpXReYANfrAAAAsgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABZuSldP63++q8AAAAsAQAACwAAAAAAAAAAAAAAgAEcAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABZuSldP5RPrrMAAADpAAAAEQAAAAAAAAAAAAAAgAH0AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA1gIAAAAA";

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

test("getDocumentExtractorDescriptor prefers recognized MIME type and falls back to extension", () => {
  assert.equal(
    getDocumentExtractorDescriptor({ name: "unknown.bin", mimeType: "application/pdf; charset=binary" })?.kind,
    "pdf",
  );
  assert.equal(getDocumentExtractorDescriptor({ name: "pricing.XLSX" })?.kind, "spreadsheet");
  assert.equal(getDocumentExtractorDescriptor({ name: "notes.txt" })?.kind, "text");
  assert.equal(getDocumentExtractorDescriptor({ name: "image.png" }), null);
});

test("extractDocumentContent extracts plain text with line provenance", async () => {
  const extraction = await extractDocumentContent({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("alpha\r\nbeta\ngamma", "utf8"),
  });

  assert.equal(extraction.kind, "text");
  assert.equal(extraction.segments.length, 1);
  assert.equal(extraction.segments[0].content, "alpha\nbeta\ngamma");
  assert.deepEqual(extraction.segments[0].locator, {
    lineStart: 1,
    lineEnd: 3,
    source: "plain_text",
  });
});

test("extractDocumentContent normalizes CSV rows with row provenance", async () => {
  const extraction = await extractDocumentContent({
    name: "pricing.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("item,qty,price\nWidget,2,10.50\n", "utf8"),
  });

  assert.equal(extraction.kind, "csv");
  assert.equal(extraction.metadata.rowCount, 2);
  assert.match(extraction.segments[0].content, /item\tqty\tprice/);
  assert.match(extraction.segments[0].content, /Widget\t2\t10\.50/);
  assert.deepEqual(extraction.segments[0].locator, {
    rowStart: 1,
    rowEnd: 2,
    source: "csv",
  });
});

test("extractDocumentContent extracts XLSX by sheet and row", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Item", "Qty"],
      ["Pump", 3],
    ]),
    "Pricing",
  );
  const written = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const buffer = Buffer.isBuffer(written) ? written : Buffer.from(written);

  const extraction = await extractDocumentContent({
    name: "pricing.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });

  assert.equal(extraction.kind, "spreadsheet");
  assert.deepEqual(extraction.metadata.sheetNames, ["Pricing"]);
  assert.equal(extraction.segments[0].segmentType, "sheet");
  assert.deepEqual(extraction.segments[0].locator, {
    sheet: "Pricing",
    rowStart: 1,
    rowEnd: 2,
  });
  assert.match(extraction.segments[0].content, /Pump\t3/);
});

test("extractDocumentContent extracts DOCX raw text", async () => {
  const extraction = await extractDocumentContent({
    name: "scope.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(DOCX_FIXTURE_BASE64, "base64"),
  });

  assert.equal(extraction.kind, "docx");
  assert.match(extraction.segments.map((segment) => segment.content).join("\n"), /GovTract DOCX text/);
  assert.equal(typeof extraction.metadata.warningCount, "number");
});

test("extractDocumentContent preserves PDF page provenance", async () => {
  const extraction = await extractDocumentContent({
    name: "solicitation.pdf",
    mimeType: "application/pdf",
    buffer: buildPdf(["GovTract PDF page one", "GovTract PDF page two"]),
  });

  assert.equal(extraction.kind, "pdf");
  assert.equal(extraction.metadata.totalPages, 2);
  assert.equal(extraction.segments.length, 2);
  assert.deepEqual(extraction.segments.map((segment) => segment.locator?.page), [1, 2]);
  assert.match(extraction.segments[0].content, /GovTract PDF page one/);
  assert.match(extraction.segments[1].content, /GovTract PDF page two/);
});

test("extractDocumentContent rejects unsupported document types", async () => {
  await assert.rejects(
    extractDocumentContent({
      name: "slide.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("not a pptx"),
    }),
    UnsupportedDocumentExtractionError,
  );
});
