import { PDFParse } from "pdf-parse";

import {
  getDocumentExtractorDescriptor,
  type DocumentContentExtraction,
} from "./extract-content";

export type ExtractedPdfPage = {
  page: number;
  text: string;
};

function sanitizeText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function recordBatchResult(input: {
  requestedPages: number[];
  extractedPages: ExtractedPdfPage[];
  pages: ExtractedPdfPage[];
  failedPages: number[];
}) {
  const returned = new Set(input.extractedPages.map((page) => page.page));
  input.pages.push(...input.extractedPages);
  for (const page of input.requestedPages) {
    if (!returned.has(page)) input.failedPages.push(page);
  }
}

export async function extractPdfPagesInBatches(input: {
  totalPages: number;
  batchSize: number;
  extractPages: (pages: number[]) => Promise<ExtractedPdfPage[]>;
}) {
  const totalPages = positiveInteger(input.totalPages, "totalPages");
  const batchSize = positiveInteger(input.batchSize, "batchSize");
  const pages: ExtractedPdfPage[] = [];
  const failedPages: number[] = [];

  for (let start = 1; start <= totalPages; start += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, totalPages - start + 1) },
      (_, index) => start + index,
    );

    try {
      const extractedPages = await input.extractPages(batch);
      recordBatchResult({ requestedPages: batch, extractedPages, pages, failedPages });
    } catch {
      for (const page of batch) {
        try {
          const extractedPages = await input.extractPages([page]);
          recordBatchResult({
            requestedPages: [page],
            extractedPages,
            pages,
            failedPages,
          });
        } catch {
          failedPages.push(page);
        }
      }
    }
  }

  pages.sort((left, right) => left.page - right.page);
  const uniqueFailedPages = Array.from(new Set(failedPages)).sort((left, right) => left - right);

  return {
    pages,
    failedPages: uniqueFailedPages,
    partial: uniqueFailedPages.length > 0,
  };
}

export async function extractPdfContentFromPath(
  path: string,
  options: { pageBatchSize?: number } = {},
): Promise<DocumentContentExtraction> {
  const descriptor = getDocumentExtractorDescriptor({
    name: "source.pdf",
    mimeType: "application/pdf",
  });
  if (!descriptor || descriptor.kind !== "pdf") {
    throw new Error("PDF extractor descriptor is unavailable");
  }

  const pageBatchSize = positiveInteger(options.pageBatchSize ?? 8, "pageBatchSize");
  const parser = new PDFParse({ url: path });

  try {
    const info = await parser.getInfo();
    const totalPages = positiveInteger(info.total, "PDF totalPages");
    const extracted = await extractPdfPagesInBatches({
      totalPages,
      batchSize: pageBatchSize,
      extractPages: async (pages) => {
        const result = await parser.getText({ partial: pages });
        return result.pages.map((page) => ({
          page: page.num,
          text: sanitizeText(page.text ?? ""),
        }));
      },
    });

    if (extracted.pages.length === 0 && extracted.failedPages.length > 0) {
      throw new Error("PDF extraction failed for every requested page");
    }

    const segments = extracted.pages
      .map((page) => ({
        segmentType: "page" as const,
        locator: { page: page.page, totalPages },
        content: page.text,
      }))
      .filter((segment) => segment.content.trim().length > 0);

    return {
      ...descriptor,
      segments,
      metadata: {
        totalPages,
        pagesWithText: segments.length,
        extractionMode: "file_page_batches",
        pageBatchSize,
        failedPages: extracted.failedPages,
        partialExtraction: extracted.partial,
      },
    };
  } finally {
    await parser.destroy();
  }
}
