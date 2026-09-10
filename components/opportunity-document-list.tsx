"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, LoaderCircle } from "lucide-react";

export type OpportunityDocumentListItem = {
  id: string;
  name: string;
  url: string | null;
  mimeType: string | null;
  fileSizeLabel: string;
  sourceDocumentKey: string;
  extractionState: "pending" | "extracted" | "failed" | "unsupported" | "stale";
  latestVersion: {
    versionNumber: number;
    checksumSha256: string | null;
  } | null;
  extraction: {
    status: string;
    checksumSha256: string;
    extractorName: string;
    extractorVersion: string;
    extractedByteCount: number;
    extractedCharCount: number;
    segmentCount: number;
    truncated: boolean;
    failureCode: string | null;
  } | null;
};

type Segment = {
  id: string;
  ordinal: number;
  segmentType: string;
  locator: Record<string, unknown>;
  content: string;
};

type ViewerState = {
  open: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  message: string | null;
  segments: Segment[];
  hasMore: boolean;
  nextCursor: number | null;
};

type ExtractionResponse = {
  state: "pending" | "extracted" | "failed";
  message?: string;
  segments: Segment[];
  hasMore: boolean;
  nextCursor: number | null;
};

function stateLabel(state: OpportunityDocumentListItem["extractionState"]) {
  if (state === "extracted") return "Extracted";
  if (state === "failed") return "Extraction failed";
  if (state === "unsupported") return "Unsupported";
  if (state === "stale") return "Outdated extraction";
  return "Extraction pending";
}

function stateDescription(document: OpportunityDocumentListItem) {
  if (document.extractionState === "unsupported") {
    return "This file type is not supported by the current extraction pipeline.";
  }
  if (document.extractionState === "stale") {
    return "A prior version was extracted, but the current document version still needs processing.";
  }
  if (document.extractionState === "failed") {
    if (document.extraction?.failureCode === "source_too_large") {
      return "This document is above the current extraction size limit.";
    }
    if (document.extraction?.failureCode === "source_bytes_unavailable") {
      return "The source file needs to be retrieved again before extraction can run.";
    }
    return "The current document could not be extracted. A later ingestion run can retry it.";
  }
  if (document.extractionState === "pending") {
    return document.latestVersion?.checksumSha256
      ? "The document is hashed and waiting for extraction."
      : "The document is waiting for source retrieval and hashing.";
  }
  return null;
}

function locatorLabel(segment: Segment) {
  const { locator } = segment;
  const page = typeof locator.page === "number" ? `Page ${locator.page}` : null;
  const sheet = typeof locator.sheet === "string" ? `Sheet: ${locator.sheet}` : null;
  const rowStart = typeof locator.rowStart === "number" ? locator.rowStart : null;
  const rowEnd = typeof locator.rowEnd === "number" ? locator.rowEnd : null;
  const rows = rowStart
    ? `Rows ${rowStart}${rowEnd && rowEnd !== rowStart ? `–${rowEnd}` : ""}`
    : null;
  const lineStart = typeof locator.lineStart === "number" ? locator.lineStart : null;
  const lineEnd = typeof locator.lineEnd === "number" ? locator.lineEnd : null;
  const lines = lineStart
    ? `Lines ${lineStart}${lineEnd && lineEnd !== lineStart ? `–${lineEnd}` : ""}`
    : null;
  return [page, sheet, rows, lines].filter(Boolean).join(" · ") || segment.segmentType;
}

function emptyViewer(open = false): ViewerState {
  return {
    open,
    loading: false,
    loaded: false,
    error: null,
    message: null,
    segments: [],
    hasMore: false,
    nextCursor: null,
  };
}

export function OpportunityDocumentList({
  opportunityId,
  documents,
}: {
  opportunityId: string;
  documents: OpportunityDocumentListItem[];
}) {
  const [viewers, setViewers] = useState<Record<string, ViewerState>>({});

  async function load(documentId: string, append: boolean) {
    const current = viewers[documentId] ?? emptyViewer(true);
    setViewers((previous) => ({
      ...previous,
      [documentId]: { ...(previous[documentId] ?? emptyViewer(true)), loading: true, error: null },
    }));

    const after = append && current.nextCursor !== null ? `?after=${current.nextCursor}` : "";
    try {
      const response = await fetch(
        `/api/opportunities/${opportunityId}/documents/${documentId}/extraction${after}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load extracted content");
      const payload = (await response.json()) as ExtractionResponse;
      setViewers((previous) => {
        const before = previous[documentId] ?? emptyViewer(true);
        return {
          ...previous,
          [documentId]: {
            ...before,
            open: true,
            loading: false,
            loaded: true,
            error: null,
            message: payload.message ?? null,
            segments: append ? [...before.segments, ...payload.segments] : payload.segments,
            hasMore: payload.hasMore,
            nextCursor: payload.nextCursor,
          },
        };
      });
    } catch {
      setViewers((previous) => ({
        ...previous,
        [documentId]: {
          ...(previous[documentId] ?? emptyViewer(true)),
          open: true,
          loading: false,
          loaded: true,
          error: "Extracted content could not be loaded. Refresh the page and try again.",
        },
      }));
    }
  }

  function toggle(document: OpportunityDocumentListItem) {
    const current = viewers[document.id] ?? emptyViewer();
    const opening = !current.open;
    setViewers((previous) => ({
      ...previous,
      [document.id]: { ...(previous[document.id] ?? emptyViewer()), open: opening },
    }));
    if (opening && !current.loaded && document.extractionState === "extracted") {
      void load(document.id, false);
    }
  }

  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {documents.map((document) => {
        const viewer = viewers[document.id] ?? emptyViewer();
        const description = stateDescription(document);
        const canInspect = document.extractionState === "extracted";
        const checksumsMatch = Boolean(
          document.latestVersion?.checksumSha256 &&
            document.extraction?.checksumSha256 === document.latestVersion.checksumSha256,
        );

        return (
          <article key={document.id} className="min-w-0 p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-semibold [overflow-wrap:anywhere]">
                  {document.name}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                  <span>{document.mimeType ?? "Type not provided"}</span>
                  <span>{document.fileSizeLabel}</span>
                  {document.latestVersion ? <span>Version {document.latestVersion.versionNumber}</span> : null}
                </div>
                <div className="mt-1 break-all text-xs text-[var(--muted-foreground)]">
                  Source key: {document.sourceDocumentKey}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="rounded-full border bg-[var(--muted)] px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)]">
                  {stateLabel(document.extractionState)}
                </span>
                {document.url ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary)] hover:underline"
                  >
                    Open document
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </div>
            </div>

            {description ? (
              <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>
            ) : null}

            {document.latestVersion?.checksumSha256 ? (
              <div className="mt-3 min-w-0 rounded-lg bg-[var(--muted)]/45 p-3 text-xs">
                <div className="font-medium">
                  Current document v{document.latestVersion.versionNumber}
                  {checksumsMatch ? " · extraction checksum matched" : ""}
                </div>
                <div className="mt-1 break-all font-mono leading-5 text-[var(--muted-foreground)]">
                  SHA-256 {document.latestVersion.checksumSha256}
                </div>
                {document.extraction ? (
                  <div className="mt-1 break-words text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                    {document.extraction.extractorName} · {document.extraction.extractorVersion} · {document.extraction.segmentCount} segments
                    {document.extraction.truncated ? " · bounded/truncated" : ""}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canInspect ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => toggle(document)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-[var(--muted)]"
                  aria-expanded={viewer.open}
                >
                  {viewer.open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  {viewer.open ? "Hide extracted content" : "Inspect extracted content"}
                </button>

                {viewer.open ? (
                  <div className="mt-3 min-w-0 rounded-xl border bg-[var(--muted)]/20 p-3 sm:p-4">
                    {viewer.loading && viewer.segments.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                        <LoaderCircle className="size-4 animate-spin" /> Loading extracted content…
                      </div>
                    ) : null}
                    {viewer.error ? (
                      <p className="text-sm text-[var(--muted-foreground)]">{viewer.error}</p>
                    ) : null}
                    {viewer.message ? (
                      <p className="text-sm text-[var(--muted-foreground)]">{viewer.message}</p>
                    ) : null}
                    <div className="grid min-w-0 gap-3">
                      {viewer.segments.map((segment) => (
                        <div key={segment.id} className="min-w-0 rounded-lg border bg-white p-3">
                          <div className="mb-2 break-words text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                            {locatorLabel(segment)}
                          </div>
                          <pre className="max-w-full whitespace-pre-wrap break-words font-sans text-sm leading-6 [overflow-wrap:anywhere]">
                            {segment.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                    {viewer.hasMore ? (
                      <button
                        type="button"
                        disabled={viewer.loading}
                        onClick={() => void load(document.id, true)}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-[var(--muted)] disabled:opacity-60"
                      >
                        {viewer.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        Load more
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
