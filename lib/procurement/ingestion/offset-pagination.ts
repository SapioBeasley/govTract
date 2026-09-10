export type OffsetPaginationTerminalReason =
  | "reported-total-zero"
  | "repeated-page-signature"
  | "total-reached"
  | "empty-page-before-total"
  | "maximum-page-bound-reached";

export type OffsetPaginationStatus = "continue" | "complete" | "partial";

export interface OffsetPaginationState {
  seenSourceRecordIds: Set<string>;
  seenPageSignatures: Set<string>;
}

export interface OffsetPaginationObservation {
  status: OffsetPaginationStatus;
  paginationComplete: boolean;
  terminalReason: OffsetPaginationTerminalReason | null;
  shouldProcessPage: boolean;
  pageSignature: string;
}

export function createOffsetPaginationState(): OffsetPaginationState {
  return {
    seenSourceRecordIds: new Set<string>(),
    seenPageSignatures: new Set<string>(),
  };
}

export function getOffsetPageCursor(input: { pageNumber: number; pageSize: number }) {
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) {
    throw new Error("Offset pagination pageNumber must be a positive integer");
  }
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1) {
    throw new Error("Offset pagination pageSize must be a positive integer");
  }

  return {
    start: (input.pageNumber - 1) * input.pageSize,
    pageSize: input.pageSize,
  };
}

function normalizeRecordIds(sourceRecordIds: readonly string[]) {
  return sourceRecordIds.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function buildOffsetPageSignature(sourceRecordIds: readonly string[]) {
  return [...normalizeRecordIds(sourceRecordIds)].sort().join("|");
}

export function observeOffsetPaginationPage(input: {
  state: OffsetPaginationState;
  pageNumber: number;
  maxPages: number;
  reportedTotal: number;
  sourceRecordIds: readonly string[];
}): OffsetPaginationObservation {
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) {
    throw new Error("Offset pagination pageNumber must be a positive integer");
  }
  if (!Number.isInteger(input.maxPages) || input.maxPages < 1) {
    throw new Error("Offset pagination maxPages must be a positive integer");
  }
  if (!Number.isInteger(input.reportedTotal) || input.reportedTotal < 0) {
    throw new Error("Offset pagination reportedTotal must be a non-negative integer");
  }

  const normalizedIds = normalizeRecordIds(input.sourceRecordIds);
  const pageSignature = [...normalizedIds].sort().join("|");

  if (input.state.seenPageSignatures.has(pageSignature)) {
    return {
      status: "partial",
      paginationComplete: false,
      terminalReason: "repeated-page-signature",
      shouldProcessPage: false,
      pageSignature,
    };
  }

  input.state.seenPageSignatures.add(pageSignature);
  for (const sourceRecordId of normalizedIds) {
    input.state.seenSourceRecordIds.add(sourceRecordId);
  }

  if (input.reportedTotal === 0) {
    return {
      status: "partial",
      paginationComplete: false,
      terminalReason: "reported-total-zero",
      shouldProcessPage: true,
      pageSignature,
    };
  }

  if (input.state.seenSourceRecordIds.size >= input.reportedTotal) {
    return {
      status: "complete",
      paginationComplete: true,
      terminalReason: "total-reached",
      shouldProcessPage: true,
      pageSignature,
    };
  }

  if (normalizedIds.length === 0) {
    return {
      status: "partial",
      paginationComplete: false,
      terminalReason: "empty-page-before-total",
      shouldProcessPage: true,
      pageSignature,
    };
  }

  if (input.pageNumber >= input.maxPages) {
    return {
      status: "partial",
      paginationComplete: false,
      terminalReason: "maximum-page-bound-reached",
      shouldProcessPage: true,
      pageSignature,
    };
  }

  return {
    status: "continue",
    paginationComplete: false,
    terminalReason: null,
    shouldProcessPage: true,
    pageSignature,
  };
}
