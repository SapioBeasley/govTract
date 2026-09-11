import { loadLatestSolicitationUnderstanding } from "./generation-persistence";

export async function loadLatestCompletedSolicitationUnderstanding(opportunityId: string) {
  const understanding = await loadLatestSolicitationUnderstanding(opportunityId);
  if (!understanding?.structuredOutput) return null;
  return {
    ...understanding,
    structuredOutput: understanding.structuredOutput,
  };
}
