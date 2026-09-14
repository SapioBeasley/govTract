from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("lib/procurement/understanding/generation.ts")
text = path.read_text()

text = replace_once(
    text,
    'import { createGeminiUnderstandingProviderFromEnv } from "./gemini";\n',
    'import { attachSourceSegmentCitations } from "./citations";\n'
    'import { createGeminiUnderstandingProviderFromEnv } from "./gemini";\n',
    "citations import",
)
text = replace_once(
    text,
    'import type { UnderstandingModelProvider, UnderstandingProviderRequest } from "./provider";\n',
    'import type { UnderstandingModelProvider, UnderstandingProviderRequest } from "./provider";\n'
    'import {\n'
    '  callUnderstandingProviderWithRetry,\n'
    '  estimateProviderRequestTokenBudgets,\n'
    '} from "./provider-call";\n',
    "provider-call import",
)
text = replace_once(
    text,
    'const STRUCTURED_OUTPUT_OVERHEAD_TOKEN_BUDGET = 4_096;\n',
    '',
    "obsolete token overhead constant",
)
text = replace_once(
    text,
    '''function conservativeInputTokenBudget(request: UnderstandingProviderRequest) {
  const bytes = Buffer.byteLength(`${request.systemInstruction}\\n${request.prompt}`, "utf8");
  return bytes + STRUCTURED_OUTPUT_OVERHEAD_TOKEN_BUDGET;
}

''',
    '',
    "obsolete conservative token helper",
)
old_preflight = '''function preflightCall(input: {
  provider: UnderstandingModelProvider;
  request: UnderstandingProviderRequest;
  maxCostMicrousd: number;
  spentCostMicrousd: number;
}) {
  const inputTokenBudget = conservativeInputTokenBudget(input.request);
  const decision = evaluateModelCallBudget({
    profile: input.provider.profile,
    inputTokenBudget,
    outputTokenBudget: input.request.maxOutputTokens,
    maxCostMicrousd: input.maxCostMicrousd,
    spentCostMicrousd: input.spentCostMicrousd,
  });
  return { inputTokenBudget, decision };
}
'''
new_preflight = '''function preflightCall(input: {
  provider: UnderstandingModelProvider;
  request: UnderstandingProviderRequest;
  maxCostMicrousd: number;
  spentCostMicrousd: number;
}) {
  const tokenBudgets = estimateProviderRequestTokenBudgets(input.request);
  const costDecision = evaluateModelCallBudget({
    profile: input.provider.profile,
    inputTokenBudget: tokenBudgets.billingInputTokenEstimate,
    outputTokenBudget: input.request.maxOutputTokens,
    maxCostMicrousd: input.maxCostMicrousd,
    spentCostMicrousd: input.spentCostMicrousd,
  });
  if (tokenBudgets.contextInputTokenUpperBound > input.provider.profile.inputTokenLimit) {
    return {
      inputTokenBudget: tokenBudgets.billingInputTokenEstimate,
      decision: {
        allowed: false as const,
        estimatedCostMicrousd: costDecision.estimatedCostMicrousd,
        remainingCostMicrousd: costDecision.remainingCostMicrousd,
        reason: "model_input_limit" as const,
      },
    };
  }
  return { inputTokenBudget: tokenBudgets.billingInputTokenEstimate, decision: costDecision };
}
'''
text = replace_once(text, old_preflight, new_preflight, "preflight")

old_chunk_start = '''    providerCallCount += 1;
    try {
      const result = await provider.generate(request);
'''
new_chunk_start = '''    try {
      const { result } = await callUnderstandingProviderWithRetry({
        provider,
        request,
        chunkKey: chunk.chunkKey,
        onAttempt: () => {
          providerCallCount += 1;
        },
        onFailure: ({ error }) => {
          const diagnostic = describeProviderFailure({
            error,
            provider: provider.profile.provider,
            model: provider.profile.model,
            chunkKey: chunk.chunkKey,
          });
          providerFailures.push(diagnostic);
          logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
        },
      });
      const citedContent = attachSourceSegmentCitations(
        result.content,
        new Set(chunk.sourceSegmentIds),
      );
'''
text = replace_once(text, old_chunk_start, new_chunk_start, "chunk provider call")
text = replace_once(
    text,
    '      outputCharCount += JSON.stringify(result.content).length;\n',
    '      outputCharCount += JSON.stringify(citedContent).length;\n',
    "chunk output chars",
)
text = replace_once(
    text,
    '      outputs.push(result.content);\n',
    '      outputs.push(citedContent);\n',
    "chunk output",
)
text = replace_once(
    text,
    '        content: result.content,\n',
    '        content: citedContent,\n',
    "chunk persisted content",
)

old_metadata_start = '''    providerCallCount += 1;
    try {
      const result = await provider.generate(request);
'''
new_metadata_start = '''    try {
      const { result } = await callUnderstandingProviderWithRetry({
        provider,
        request,
        chunkKey: null,
        onAttempt: () => {
          providerCallCount += 1;
        },
        onFailure: ({ error }) => {
          const diagnostic = describeProviderFailure({
            error,
            provider: provider.profile.provider,
            model: provider.profile.model,
            chunkKey: null,
          });
          providerFailures.push(diagnostic);
          logProviderFailure({ understandingId, opportunityId: input.opportunityId, diagnostic });
        },
      });
      const citedContent = attachSourceSegmentCitations(result.content, new Set());
'''
text = replace_once(text, old_metadata_start, new_metadata_start, "metadata provider call")
text = replace_once(
    text,
    '      outputCharCount += JSON.stringify(result.content).length;\n',
    '      outputCharCount += JSON.stringify(citedContent).length;\n',
    "metadata output chars",
)
text = replace_once(
    text,
    '      outputs.push(result.content);\n',
    '      outputs.push(citedContent);\n',
    "metadata output",
)
path.write_text(text)


env_path = Path(".env.example")
env_text = env_path.read_text()
env_text = replace_once(
    env_text,
    "GOVTRACT_AI_UNDERSTANDING_MAX_CHUNK_CHARS=32000",
    "GOVTRACT_AI_UNDERSTANDING_MAX_CHUNK_CHARS=200000",
    "env chunk size",
)
env_path.write_text(env_text)


test_path = Path("tests/integration/understanding/provider-observability.test.ts")
test_text = test_path.read_text()
test_text = replace_once(
    test_text,
    "        if (calls === 2) {",
    "        if (calls >= 2) {",
    "observability persistent 429 fixture",
)
test_text = replace_once(test_text, "      assert.equal(calls, 2);", "      assert.equal(calls, 4);", "observability calls")
test_text = replace_once(
    test_text,
    "      assert.equal(run?.usage_metadata.providerCallCount, 2);",
    "      assert.equal(run?.usage_metadata.providerCallCount, 4);",
    "observability providerCallCount",
)
test_text = replace_once(
    test_text,
    "      assert.equal(run?.usage_metadata.providerFailures?.length, 1);",
    "      assert.equal(run?.usage_metadata.providerFailures?.length, 3);",
    "observability failure count",
)
test_path.write_text(test_text)
