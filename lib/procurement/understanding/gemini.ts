import { isSolicitationUnderstandingContent } from "./types";
import type { UnderstandingModelProvider, UnderstandingProviderUsage } from "./provider";

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_PRICING_PROFILE_VERSION = "gemini-3.8-flash-standard-2026-09";
const DEFAULT_INPUT_TOKEN_LIMIT = 1_048_576;
const DEFAULT_OUTPUT_TOKEN_LIMIT = 65_536;
const DEFAULT_INPUT_COST_USD_PER_MILLION = 0.75;
const DEFAULT_OUTPUT_COST_USD_PER_MILLION = 3.75;

const findingSchema = {
  type: "object",
  properties: {
    key: {
      type: "string",
      description: "Stable concise machine-readable finding key, unique within its section.",
    },
    text: {
      type: "string",
      description: "Concise contractor-actionable statement supported by the provided source material.",
    },
  },
  required: ["key", "text"],
} as const;

const findingArraySchema = {
  type: "array",
  items: findingSchema,
} as const;

export const solicitationUnderstandingJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Plain-language explanation of what the solicitation is asking the contractor to do.",
    },
    scope: findingArraySchema,
    deliverables: findingArraySchema,
    workBreakdown: findingArraySchema,
    location: findingArraySchema,
    schedule: findingArraySchema,
    quantities: findingArraySchema,
    qualifications: findingArraySchema,
    insuranceBonding: findingArraySchema,
    mandatoryEvents: findingArraySchema,
    pricingInstructions: findingArraySchema,
    submissionComponents: findingArraySchema,
    evaluationCriteria: findingArraySchema,
    disqualifiers: findingArraySchema,
    questionsAmbiguities: findingArraySchema,
  },
  required: [
    "summary",
    "scope",
    "deliverables",
    "workBreakdown",
    "location",
    "schedule",
    "quantities",
    "qualifications",
    "insuranceBonding",
    "mandatoryEvents",
    "pricingInstructions",
    "submissionComponents",
    "evaluationCriteria",
    "disqualifiers",
    "questionsAmbiguities",
  ],
} as const;

type FetchLike = typeof fetch;

export type GeminiUnderstandingProviderConfig = {
  apiKey: string;
  model: string;
  modelVersion: string | null;
  billingMode: "billable" | "non_billable";
  pricingProfileVersion: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  inputCostMicrousdPerMillionTokens: number;
  outputCostMicrousdPerMillionTokens: number;
  fetchImpl?: FetchLike;
};

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function usdPerMillionToMicrousd(value: string | undefined, fallback: number, name: string) {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a nonnegative number`);
  const microusd = Math.round(parsed * 1_000_000);
  if (!Number.isSafeInteger(microusd)) throw new Error(`${name} is too large`);
  return microusd;
}

function parseBillingMode(value: string | undefined): "billable" | "non_billable" {
  if (!value || value === "billable") return "billable";
  if (value === "non_billable") return "non_billable";
  throw new Error("GEMINI_BILLING_MODE must be billable or non_billable");
}

export function loadGeminiUnderstandingProviderConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GeminiUnderstandingProviderConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini solicitation understanding");

  return {
    apiKey,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    modelVersion: env.GEMINI_MODEL_VERSION?.trim() || null,
    billingMode: parseBillingMode(env.GEMINI_BILLING_MODE?.trim()),
    pricingProfileVersion:
      env.GEMINI_PRICING_PROFILE_VERSION?.trim() || DEFAULT_PRICING_PROFILE_VERSION,
    inputTokenLimit: positiveInteger(
      env.GEMINI_INPUT_TOKEN_LIMIT,
      DEFAULT_INPUT_TOKEN_LIMIT,
      "GEMINI_INPUT_TOKEN_LIMIT",
    ),
    outputTokenLimit: positiveInteger(
      env.GEMINI_OUTPUT_TOKEN_LIMIT,
      DEFAULT_OUTPUT_TOKEN_LIMIT,
      "GEMINI_OUTPUT_TOKEN_LIMIT",
    ),
    inputCostMicrousdPerMillionTokens: usdPerMillionToMicrousd(
      env.GEMINI_INPUT_COST_USD_PER_MILLION,
      DEFAULT_INPUT_COST_USD_PER_MILLION,
      "GEMINI_INPUT_COST_USD_PER_MILLION",
    ),
    outputCostMicrousdPerMillionTokens: usdPerMillionToMicrousd(
      env.GEMINI_OUTPUT_COST_USD_PER_MILLION,
      DEFAULT_OUTPUT_COST_USD_PER_MILLION,
      "GEMINI_OUTPUT_COST_USD_PER_MILLION",
    ),
  };
}

function parseUsage(value: unknown): UnderstandingProviderUsage {
  const usage = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: string) => {
    const current = usage[key];
    return typeof current === "number" && Number.isFinite(current) && current >= 0
      ? Math.floor(current)
      : 0;
  };
  return {
    promptTokenCount: number("promptTokenCount"),
    candidatesTokenCount: number("candidatesTokenCount"),
    thoughtsTokenCount: number("thoughtsTokenCount"),
    totalTokenCount: number("totalTokenCount"),
  };
}

function responseText(data: Record<string, unknown>) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = candidates[0];
  if (!candidate || typeof candidate !== "object") return null;
  const content = (candidate as Record<string, unknown>).content;
  if (!content || typeof content !== "object") return null;
  const parts = Array.isArray((content as Record<string, unknown>).parts)
    ? ((content as Record<string, unknown>).parts as unknown[])
    : [];
  const text = parts
    .map((part) =>
      part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
        ? ((part as Record<string, unknown>).text as string)
        : "",
    )
    .join("")
    .trim();
  return text || null;
}

function providerErrorMessage(status: number, data: unknown) {
  let detail = "";
  if (data && typeof data === "object") {
    const error = (data as Record<string, unknown>).error;
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
      detail = `: ${(error as Record<string, unknown>).message as string}`;
    }
  }
  return `Gemini generateContent failed with HTTP ${status}${detail}`;
}

export function createGeminiUnderstandingProvider(
  config: GeminiUnderstandingProviderConfig,
): UnderstandingModelProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const model = config.model.trim();
  if (!model) throw new Error("Gemini model is required");

  return {
    profile: {
      id: config.pricingProfileVersion,
      provider: "gemini",
      model,
      billingMode: config.billingMode,
      inputTokenLimit: config.inputTokenLimit,
      outputTokenLimit: config.outputTokenLimit,
      inputCostMicrousdPerMillionTokens: config.inputCostMicrousdPerMillionTokens,
      outputCostMicrousdPerMillionTokens: config.outputCostMicrousdPerMillionTokens,
    },
    modelVersion: config.modelVersion,
    async generate(input) {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": config.apiKey,
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: input.systemInstruction }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: input.prompt }],
              },
            ],
            generationConfig: {
              maxOutputTokens: input.maxOutputTokens,
              temperature: 0.2,
              responseFormat: {
                text: {
                  mimeType: "application/json",
                  schema: solicitationUnderstandingJsonSchema,
                },
              },
            },
          }),
        },
      );

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) throw new Error(providerErrorMessage(response.status, data));
      if (!data || typeof data !== "object") throw new Error("Gemini returned an invalid response envelope");

      const envelope = data as Record<string, unknown>;
      const text = responseText(envelope);
      if (!text) throw new Error("Gemini returned no structured solicitation understanding");

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Gemini returned invalid JSON for solicitation understanding");
      }
      if (!isSolicitationUnderstandingContent(parsed)) {
        throw new Error("Gemini returned an invalid solicitation understanding structure");
      }

      return {
        content: parsed,
        modelVersion:
          typeof envelope.modelVersion === "string" ? envelope.modelVersion : config.modelVersion,
        usage: parseUsage(envelope.usageMetadata),
      };
    },
  };
}

export function createGeminiUnderstandingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return createGeminiUnderstandingProvider(loadGeminiUnderstandingProviderConfigFromEnv(env));
}
