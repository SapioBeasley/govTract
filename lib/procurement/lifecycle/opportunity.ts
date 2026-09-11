import type { ProcurementSourceAuthority } from "@/lib/procurement/sources/authority";

export type OpportunityLifecycleState =
  | "active"
  | "inactive_unknown"
  | "closed"
  | "awarded"
  | "cancelled";

export type OpportunityTerminalLifecycleState = Exclude<
  OpportunityLifecycleState,
  "active" | "inactive_unknown"
>;

export type LifecycleTerminalEvidenceField = "status" | "sourceStatus";

export interface SourceOpportunityLifecycleInput {
  sourceRecordActive: boolean;
  status?: string | null;
  sourceStatus?: string | null;
}

export interface CanonicalOpportunityLifecycleSource extends SourceOpportunityLifecycleInput {
  source: string;
  sourceRecordId: string;
  authority: ProcurementSourceAuthority;
  isPrimary: boolean;
}

export type CanonicalOpportunityLifecycleEvidence =
  | {
      kind: "active_source";
      source: string;
      sourceRecordId: string;
    }
  | {
      kind: "terminal_status";
      source: string;
      sourceRecordId: string;
      field: LifecycleTerminalEvidenceField;
      value: string;
    }
  | {
      kind: "source_disappearance";
    };

export interface CanonicalOpportunityLifecycleResult {
  state: OpportunityLifecycleState;
  evidence: CanonicalOpportunityLifecycleEvidence;
}

const TERMINAL_STATUS_ALIASES: Record<OpportunityTerminalLifecycleState, Set<string>> = {
  cancelled: new Set([
    "cancelled",
    "canceled",
    "cancelled solicitation",
    "canceled solicitation",
    "withdrawn",
  ]),
  awarded: new Set(["awarded", "award", "award made", "contract awarded"]),
  closed: new Set(["closed", "expired", "complete", "completed"]),
};

const AUTHORITY_RANK: Record<ProcurementSourceAuthority, number> = {
  authoritative: 3,
  unknown: 2,
  aggregator: 1,
};

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") ?? "";
}

function terminalStateForValue(
  value: string | null | undefined,
): OpportunityTerminalLifecycleState | null {
  const normalized = normalizeStatus(value);
  if (!normalized) return null;

  for (const state of ["cancelled", "awarded", "closed"] as const) {
    if (TERMINAL_STATUS_ALIASES[state].has(normalized)) return state;
  }

  return null;
}

export function deriveSourceOpportunityLifecycle(input: SourceOpportunityLifecycleInput): {
  state: OpportunityLifecycleState;
  terminalEvidence: LifecycleTerminalEvidenceField | null;
} {
  const sourceStatusTerminal = terminalStateForValue(input.sourceStatus);
  if (sourceStatusTerminal) {
    return { state: sourceStatusTerminal, terminalEvidence: "sourceStatus" };
  }

  const statusTerminal = terminalStateForValue(input.status);
  if (statusTerminal) {
    return { state: statusTerminal, terminalEvidence: "status" };
  }

  return {
    state: input.sourceRecordActive ? "active" : "inactive_unknown",
    terminalEvidence: null,
  };
}

function compareLifecycleSources(
  left: CanonicalOpportunityLifecycleSource,
  right: CanonicalOpportunityLifecycleSource,
) {
  const authority = AUTHORITY_RANK[right.authority] - AUTHORITY_RANK[left.authority];
  if (authority !== 0) return authority;

  const active = Number(right.sourceRecordActive) - Number(left.sourceRecordActive);
  if (active !== 0) return active;

  const primary = Number(right.isPrimary) - Number(left.isPrimary);
  if (primary !== 0) return primary;

  const source = left.source.localeCompare(right.source);
  if (source !== 0) return source;
  return left.sourceRecordId.localeCompare(right.sourceRecordId);
}

export function selectCanonicalOpportunityLifecycle(
  sources: CanonicalOpportunityLifecycleSource[],
): CanonicalOpportunityLifecycleResult {
  const evaluated = sources.map((source) => ({
    source,
    derived: deriveSourceOpportunityLifecycle(source),
  }));

  const activeSources = evaluated
    .filter(
      ({ source, derived }) => source.sourceRecordActive && derived.state === "active",
    )
    .map(({ source }) => source)
    .sort(compareLifecycleSources);

  const activeSource = activeSources[0];
  if (activeSource) {
    return {
      state: "active",
      evidence: {
        kind: "active_source",
        source: activeSource.source,
        sourceRecordId: activeSource.sourceRecordId,
      },
    };
  }

  const terminalCandidates = evaluated
    .filter(
      ({ derived }) => derived.state !== "active" && derived.state !== "inactive_unknown",
    )
    .sort((left, right) => compareLifecycleSources(left.source, right.source));

  const terminal = terminalCandidates[0];
  if (terminal && terminal.derived.terminalEvidence) {
    const field = terminal.derived.terminalEvidence;
    const value = field === "sourceStatus" ? terminal.source.sourceStatus : terminal.source.status;
    return {
      state: terminal.derived.state,
      evidence: {
        kind: "terminal_status",
        source: terminal.source.source,
        sourceRecordId: terminal.source.sourceRecordId,
        field,
        value: value ?? "",
      },
    };
  }

  return {
    state: "inactive_unknown",
    evidence: { kind: "source_disappearance" },
  };
}

export function isOpportunityLifecycleActive(state: OpportunityLifecycleState) {
  return state === "active";
}
