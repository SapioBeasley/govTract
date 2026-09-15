import type { OpportunityLifecycleState } from "@/lib/procurement/lifecycle/opportunity";

export type BeaconRenderedLifecycleState = Extract<
  OpportunityLifecycleState,
  "pending_award" | "awarded" | "cancelled" | "closed"
>;

export interface BeaconRenderedLifecycleObservation {
  state: BeaconRenderedLifecycleState;
  sourceStatus: string;
  evidenceText: string;
}

const STATUS_ALIASES: Array<{
  state: BeaconRenderedLifecycleState;
  labels: Set<string>;
}> = [
  {
    state: "pending_award",
    labels: new Set(["pending award", "pending contract award", "awaiting award", "award pending"]),
  },
  {
    state: "awarded",
    labels: new Set(["awarded", "award made", "contract awarded"]),
  },
  {
    state: "cancelled",
    labels: new Set(["cancelled", "canceled", "withdrawn"]),
  },
  {
    state: "closed",
    labels: new Set(["closed", "expired", "complete", "completed"]),
  },
];

function normalizeLine(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Beacon's bidder-facing solicitation page renders the procurement lifecycle as a short,
 * standalone status label. Match exact normalized lines only so words such as "award" in
 * solicitation instructions or evaluation criteria cannot invent a terminal lifecycle state.
 */
export function parseBeaconRenderedLifecycle(
  pageText: string,
): BeaconRenderedLifecycleObservation | null {
  const lines = pageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const candidate of STATUS_ALIASES) {
    const matchingLine = lines.find((line) => candidate.labels.has(normalizeLine(line)));
    if (matchingLine) {
      return {
        state: candidate.state,
        sourceStatus: matchingLine,
        evidenceText: matchingLine,
      };
    }
  }

  return null;
}
