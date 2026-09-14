import type {
  UnderstandingModelProvider,
  UnderstandingProviderRequest,
  UnderstandingProviderResult,
} from "./provider";

const STRUCTURED_OUTPUT_OVERHEAD_TOKEN_BUDGET = 4_096;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

export type ProviderRetryFailure = {
  error: unknown;
  httpStatus: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
};

export function estimateProviderRequestTokenBudgets(request: UnderstandingProviderRequest) {
  const bytes = Buffer.byteLength(`${request.systemInstruction}\n${request.prompt}`, "utf8");
  return {
    contextInputTokenUpperBound: bytes + STRUCTURED_OUTPUT_OVERHEAD_TOKEN_BUDGET,
    billingInputTokenEstimate: Math.ceil(bytes / 2) + STRUCTURED_OUTPUT_OVERHEAD_TOKEN_BUDGET,
  };
}

function parseProviderStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  return match?.[1] ? Number(match[1]) : null;
}

function retryAfterMsFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const seconds = message.match(/\bretry\s+in\s+([0-9]+(?:\.[0-9]+)?)s\b/i)?.[1];
  if (!seconds) return null;
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(1, Math.ceil(parsed * 1_000));
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function callUnderstandingProviderWithRetry(input: {
  provider: UnderstandingModelProvider;
  request: UnderstandingProviderRequest;
  chunkKey: string | null;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: () => void;
  onFailure?: (failure: ProviderRetryFailure) => void;
}): Promise<{ result: UnderstandingProviderResult; attemptCount: number }> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  const sleep = input.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.onAttempt?.();
    try {
      const result = await input.provider.generate(input.request);
      return { result, attemptCount: attempt };
    } catch (error) {
      lastError = error;
      const httpStatus = parseProviderStatus(error);
      const retryable = httpStatus === 429 || (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599);
      const failure = {
        error,
        httpStatus,
        retryable,
        retryAfterMs: retryable ? retryAfterMsFromError(error) : null,
      };
      const willRetry = retryable && attempt < maxAttempts;
      if (!willRetry) break;
      input.onFailure?.(failure);
      const exponentialDelay = Math.min(
        DEFAULT_MAX_DELAY_MS,
        DEFAULT_BASE_DELAY_MS * 2 ** (attempt - 1),
      );
      await sleep(Math.min(DEFAULT_MAX_DELAY_MS, failure.retryAfterMs ?? exponentialDelay));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Provider request failed.");
}
