/**
 * Standalone manual fixture evaluation, deliberately separate from persisted
 * opportunity understanding generation and the automatic one-cycle budget.
 * Emits only case IDs, missing gold IDs and non-sensitive provider usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  assertExplicitManualUnderstandingEvaluation,
  executeUnderstandingEvaluation, planUnderstandingEvaluation,
  type UnderstandingEvaluationCase,
} from "../lib/procurement/understanding/evaluation";
import { createGeminiUnderstandingProviderFromEnv } from "../lib/procurement/understanding/gemini";

function budgetFromEnv(value: string | undefined): number {
  const raw = value?.trim() || "0.12";
  if (!/^(?:0|0?\.\d{1,6})$/.test(raw)) throw new Error("Evaluation budget must be 0–0.12 USD with at most six decimals.");
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6,"0"));
}

async function main() {
  // Refuse to load a provider secret or call any model on PR/push/schedule.
  assertExplicitManualUnderstandingEvaluation(process.env);
  const count = Number(process.env.EVAL_MAX_CASES ?? "3");
  const maxCostMicrousd = budgetFromEnv(process.env.EVAL_MAX_COST_USD);
  const fixtures = JSON.parse(readFileSync(
    "tests/fixtures/understanding/47-cross-industry-requirements.json", "utf8",
  )) as UnderstandingEvaluationCase[];
  const plan = planUnderstandingEvaluation(fixtures,{maxCases:count,maxCostMicrousd});
  const provider = createGeminiUnderstandingProviderFromEnv({
    ...process.env,GEMINI_BILLING_MODE:"billable",
  });
  const report = await executeUnderstandingEvaluation(plan,provider);
  const outputPath = ".artifacts/understanding-evaluation.json";
  mkdirSync(dirname(outputPath),{recursive:true});
  writeFileSync(outputPath,JSON.stringify({
    ...report,manualTrigger:"workflow_dispatch",
    completedAt:new Date().toISOString(),
  },null,2) + "\n");
  console.log(JSON.stringify({
    evaluation:report.passed ? "passed" : "failed",
    model:report.model,modelVersion:report.modelVersion,
    promptVersion:report.promptVersion,fixtureSha256:report.fixtureSha256,
    cases:report.cases.map(({id,passed,missing,missingCitations}) =>
      ({id,passed,missing,missingCitations})),
    calls:report.calls,estimatedCostMicrousd:report.estimatedCostMicrousd,
    actualCostMicrousd:report.actualCostMicrousd,
  }));
  if (!report.passed) process.exitCode=1;
}

main().catch(() => {
  // Provider error messages may contain source excerpts or credentials.
  console.error("Manual understanding evaluation stopped: review input, provider configuration and bounded usage.");
  process.exitCode=1;
});
