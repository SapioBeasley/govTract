import type { UnderstandingModelPricingProfile } from "./planning";
import type { SolicitationUnderstandingContent } from "./types";

export type UnderstandingProviderUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
};

export type UnderstandingProviderRequest = {
  systemInstruction: string;
  prompt: string;
  maxOutputTokens: number;
};

export type UnderstandingProviderResult = {
  content: SolicitationUnderstandingContent;
  modelVersion: string | null;
  usage: UnderstandingProviderUsage;
};

export interface UnderstandingModelProvider {
  profile: UnderstandingModelPricingProfile;
  modelVersion: string | null;
  generate(input: UnderstandingProviderRequest): Promise<UnderstandingProviderResult>;
}
