import { parse as parseCsv } from "csv-parse/sync";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "@e965/xlsx";

import type { ExtractionSegmentInput, ExtractionSegmentType } from "./extractions";

export type DocumentExtractionKind = "pdf" | "docx" | "spreadsheet" | "csv" | "text";

export type DocumentExtractorDescriptor = {
  kind: DocumentExtractionKind;
  extractorName: string;
  extractorVersion: string;
};

export type DocumentContentExtraction = DocumentExtractorDescriptor & {
  segments: ExtractionSegmentInput[];
  metadata: Record<string, unknown>;
};

const TARGET_SEGMENT_BYTES = 128 * 1024;
const PIPELINE_VERSION = "1";

const DESCRIPTORS: Record<DocumentExtractionKind, DocumentExtractorDescriptor> = {
  pdf: {
    kind: "pdf",
    extractorName: "govtract/pdf-text",
    extractorVersion: `${PIPELINE_VERSION}+pdf-parse@2.4.5`,
  },
  docx: {
    kind: "docx",
    extractorName: "govtract/docx-text",
    extractorVersion: `${PIPELINE_VERSION}+mammoth@1.12.2`,
  },
  spreadsheet: {
    kind: "spreadsheet",
    extractorName: "govtract/spreadsheet-text",
    extractorVersion: `${PIPELINE_VERSION}+sheetjs@0.20.3`,
  },
  csv: {
    kind: "csv",
    extractorName: "govtract/csv-text",
    extractorVersion: `${PIPELINE_VERSION}+csv-parse@7.0.2`,
  },
  text: {
    kind: "text",
    extractorName: "govtract/plain-text",
    extractorVersion: PIPELINE_VERSION,
  },
};

const MIME_KIND = new Map<string, DocumentExtractionKind>([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "spreadsheet"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
  ["text/csv", "csv"],
  ["application/csv", "csv"],
  ["text/plain", "text"],
]);

const EXTENSION_KIND: Array<[string, DocumentExtractionKind]> = [
  [".pdf", "pdf"],
  [".docx", "docx"],
  [".xlsx", "spreadsheet"],
  [".xls", "spreadsheet"],
  [".csv", "csv"],
  [".txt", "text"],
];

export class UnsupportedDocumentExtractionError extends Error {
  constructor() {
    super("Document type is not supported by the extraction pipeline");
    this.name = "UnsupportedDocumentExtractionError";
  }
}

function normalizedMimeType(mimeType?: string | null) {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

export function getDocumentExtractorDescriptor(input: {
  name?: string | null;
  mimeType?: string | null;
}): DocumentExtractorDescriptor | null {
  const mimeType = normalizedMimeType(input.mimeType);
  const mimeKind = mimeType ? MIME_KIND.get(mimeType) : undefined;
  if (mimeKind) return DESCRIPTORS[mimeKind];

  const name = input.name?.trim().toLowerCase();
  if (!name) return null;
  const extensionKind = EXTENSION_KIND.find(([extension]) => name.endsWith(extension))?.[1];
  return extensionKind ? DESCRIPTORS[extensionKind] : null;
}

function sanitizeText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
}

function utf8Chunks(value: string, maxBytes = TARGET_SEGMENT_BYTES) {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of value) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }

  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

function chunkIndexedLines(input: {
  lines: string[];
  segmentType: ExtractionSegmentType;
  locator: (startIndex: number, endIndex: number, part?: number) => Record<string, unknown>;
}) {
  const segments: ExtractionSegmentInput[] = [];
  let pending: string[] = [];
  let pendingStart = 0;
  let pendingBytes = 0;

  const flush = (endIndex: number) => {
    if (pending.length === 0) return;
    segments.push({
      segmentType: input.segmentType,
      locator: input.locator(pendingStart, endIndex),
      content: sanitizeText(pending.join("\n")),
    });
    pending = [];
    pendingBytes = 0;
  };

  input.lines.forEach((rawLine, index) => {
    const line = sanitizeText(rawLine);
    const lineBytes = Buffer.byteLength(line, "utf8");
    const separatorBytes = pending.length > 0 ? 1 : 0;

    if (lineBytes > TARGET_SEGMENT_BYTES) {
      flush(index - 1);
      utf8Chunks(line).forEach((chunk, part) => {
        segments.push({
          segmentType: input.segmentType,
          locator: input.locator(index, index, part + 1),
          content: chunk,
        });
      });
      pendingStart = index + 1;
      return;
    }

    if (pending.length > 0 && pendingBytes + separatorBytes + lineBytes > TARGET_SEGMENT_BYTES) {
      flush(index - 1);
      pendingStart = index;
    } else if (pending.length === 0) {
      pendingStart = index;
    }

    pending.push(line);
    pendingBytes += (pending.length > 1 ? 1 : 0) + lineBytes;
  });

  flush(input.lines.length - 1);
  return segments;
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function extractPdf(buffer: Buffer): Promise<DocumentContentExtraction> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const segments = result.pages
      .map((page) => ({
        segmentType: "page" as const,
        locator: { page: page.num, totalPages: result.total },
        content: sanitizeText(page.text ?? ""),
      }))
      .filter((segment) => segment.content.trim().length > 0);

    return {
      ...DESCRIPTORS.pdf,
      segments,
      metadata: {
        totalPages: result.total,
        pagesWithText: segments.length,
      },
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<DocumentContentExtraction> {
  const result = await mammoth.extractRawText({ buffer });
  const text = sanitizeText(result.value ?? "");
  const lines = text.split("\n");
  const segments = chunkIndexedLines({
    lines,
    segmentType: "section",
    locator: (start, end, part) => ({
      lineStart: start + 1,
      lineEnd: end + 1,
      ...(part ? { part } : {}),
      source: "docx_raw_text",
    }),
  }).filter((segment) => segment.content.trim().length > 0);

  return {
    ...DESCRIPTORS.docx,
    segments,
    metadata: {
      warningCount: result.messages.length,
      lineCount: lines.length,
    },
  };
}

function extractSpreadsheet(buffer: Buffer): DocumentContentExtraction {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });

  const segments: ExtractionSegmentInput[] = [];
  const sheetRowCounts: Record<string, number> = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    sheetRowCounts[sheetName] = rows.length;

    const lines = rows.map((row) => row.map(stringifyCell).join("\t"));
    segments.push(
      ...chunkIndexedLines({
        lines,
        segmentType: "sheet",
        locator: (start, end, part) => ({
          sheet: sheetName,
          rowStart: start + 1,
          rowEnd: end + 1,
          ...(part ? { part } : {}),
        }),
      }).filter((segment) => segment.content.trim().length > 0),
    );
  }

  return {
    ...DESCRIPTORS.spreadsheet,
    segments,
    metadata: {
      sheetCount: workbook.SheetNames.length,
      sheetNames: workbook.SheetNames,
      sheetRowCounts,
    },
  };
}

function extractCsv(buffer: Buffer): DocumentContentExtraction {
  const text = sanitizeText(buffer.toString("utf8")).replace(/^\uFEFF/, "");
  const records = parseCsv(text, {
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
  }) as unknown[][];
  const lines = records.map((record) => record.map(stringifyCell).join("\t"));
  const segments = chunkIndexedLines({
    lines,
    segmentType: "table",
    locator: (start, end, part) => ({
      rowStart: start + 1,
      rowEnd: end + 1,
      ...(part ? { part } : {}),
      source: "csv",
    }),
  }).filter((segment) => segment.content.trim().length > 0);

  return {
    ...DESCRIPTORS.csv,
    segments,
    metadata: { rowCount: records.length },
  };
}

function extractText(buffer: Buffer): DocumentContentExtraction {
  const text = sanitizeText(buffer.toString("utf8")).replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const segments = chunkIndexedLines({
    lines,
    segmentType: "section",
    locator: (start, end, part) => ({
      lineStart: start + 1,
      lineEnd: end + 1,
      ...(part ? { part } : {}),
      source: "plain_text",
    }),
  }).filter((segment) => segment.content.trim().length > 0);

  return {
    ...DESCRIPTORS.text,
    segments,
    metadata: { lineCount: lines.length },
  };
}

export async function extractDocumentContent(input: {
  name?: string | null;
  mimeType?: string | null;
  buffer: Buffer;
}): Promise<DocumentContentExtraction> {
  const descriptor = getDocumentExtractorDescriptor(input);
  if (!descriptor) throw new UnsupportedDocumentExtractionError();

  switch (descriptor.kind) {
    case "pdf":
      return extractPdf(input.buffer);
    case "docx":
      return extractDocx(input.buffer);
    case "spreadsheet":
      return extractSpreadsheet(input.buffer);
    case "csv":
      return extractCsv(input.buffer);
    case "text":
      return extractText(input.buffer);
  }
}
