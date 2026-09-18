"use client";

import { CheckCircle2, LoaderCircle, RotateCcw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type FactorStatus = "pass" | "risk" | "blocker" | "unknown";
type Assessment = "go" | "conditional" | "no_go";
type Decision = "pursue" | "do_not_pursue" | "revisit";

export type EvaluationFactorClient = {
  key: string;
  kind: string;
  status: FactorStatus;
  requirementLevel?: "required" | "optional" | "unknown";
  summary: string;
  requirementKey?: string;
  evidence: Array<{
    opportunityDocumentVersionId: string;
    documentExtractionSegmentId: string | null;
    locator: Record<string, unknown>;
    excerpt: string | null;
  }>;
};

export type EvaluationClientState = {
  id: string;
  opportunityId: string;
  companyProfileId: string;
  solicitationUnderstandingId: string | null;
  inputFingerprint: string;
  ruleVersion: string;
  assessment: Assessment;
  factors: EvaluationFactorClient[];
  evaluatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DecisionClientState = {
  id: string;
  opportunityId: string;
  companyProfileId: string;
  evaluationId: string | null;
  decision: Decision;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
};

function assessmentLabel(assessment: Assessment) {
  if (assessment === "no_go") return "No-go";
  if (assessment === "conditional") return "Conditional";
  return "Go";
}

function groupTitle(status: FactorStatus) {
  if (status === "blocker") return "Critical blockers";
  if (status === "pass") return "Strengths / confirmed fit";
  if (status === "risk") return "Risks / gaps";
  return "Unknown / needs review";
}

function evidenceLocation(locator: Record<string, unknown>) {
  const entries = Object.entries(locator)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .slice(0, 4);
  if (!entries.length) return null;
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

function FactorCard({ factor }: { factor: EvaluationFactorClient }) {
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          {factor.kind.replaceAll("_", " ")}
        </span>
        {factor.requirementLevel ? (
          <span className="text-xs capitalize text-[var(--muted-foreground)]">
            {factor.requirementLevel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {factor.summary}
      </p>
      {factor.evidence.length ? (
        <div className="mt-3 grid min-w-0 gap-2">
          {factor.evidence.slice(0, 3).map((evidence, index) => {
            const location = evidenceLocation(evidence.locator);
            return (
              <div
                key={`${evidence.opportunityDocumentVersionId}-${evidence.documentExtractionSegmentId ?? index}`}
                className="min-w-0 rounded-lg bg-[var(--muted)]/55 p-2.5 text-xs leading-5 text-[var(--muted-foreground)]"
              >
                {location ? <p className="font-medium">{location}</p> : null}
                {evidence.excerpt ? (
                  <p className="mt-1 break-words [overflow-wrap:anywhere]">{evidence.excerpt}</p>
                ) : (
                  <p className="mt-1">Requirement evidence is linked to the stored solicitation document version.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function OpportunityEvaluationPanel({
  opportunityId,
  profileAvailable,
  initialEvaluation,
  initialDecision,
}: {
  opportunityId: string;
  profileAvailable: boolean;
  initialEvaluation: EvaluationClientState | null;
  initialDecision: DecisionClientState | null;
}) {
  const [evaluation, setEvaluation] = useState(initialEvaluation);
  const [decision, setDecision] = useState(initialDecision);
  const [pending, setPending] = useState<"evaluate" | Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function evaluate() {
    setPending("evaluate");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/evaluation`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { evaluation?: EvaluationClientState; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.evaluation) {
        setError(payload?.error?.message ?? "Opportunity could not be evaluated.");
        return;
      }
      setEvaluation(payload.evaluation);
      setNotice("Evaluation updated from the current profile and solicitation evidence.");
    } catch {
      setError("Opportunity could not be evaluated.");
    } finally {
      setPending(null);
    }
  }

  async function choose(nextDecision: Decision) {
    setPending(nextDecision);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/opportunities/${opportunityId}/evaluation/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: nextDecision }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            decision?: DecisionClientState;
            savedStatus?: string;
            pursuitSnapshotStatus?: string;
            error?: { message?: string };
          }
        | null;
      if (!response.ok || !payload?.decision) {
        setError(payload?.error?.message ?? "Decision could not be recorded.");
        return;
      }
      setDecision(payload.decision);
      setNotice(
        nextDecision === "pursue"
          ? `Marked for pursuit. Snapshot status: ${payload.pursuitSnapshotStatus ?? "unknown"}.`
          : nextDecision === "do_not_pursue"
            ? "Recorded as do not pursue."
            : "Recorded for revisit.",
      );
    } catch {
      setError("Decision could not be recorded.");
    } finally {
      setPending(null);
    }
  }

  if (!profileAvailable) {
    return (
      <div className="min-w-0 rounded-xl border border-dashed bg-[var(--muted)]/40 p-4 text-sm leading-6">
        Complete the{" "}
        <Link href="/company" className="font-semibold underline underline-offset-4">
          Company profile
        </Link>{" "}
        before evaluating this opportunity.
      </div>
    );
  }

  const statuses: FactorStatus[] = ["blocker", "pass", "risk", "unknown"];

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {evaluation ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-full border px-3 py-1 text-sm font-semibold">
                {assessmentLabel(evaluation.assessment)}
              </span>
              <span className="break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                Rules {evaluation.ruleVersion} · evaluated{" "}
                {new Date(evaluation.evaluatedAt).toLocaleString()}
              </span>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              No go/no-go assessment has been run for this opportunity yet.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={evaluate}
          disabled={pending !== null}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending === "evaluate" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : evaluation ? (
            <RotateCcw className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {pending === "evaluate" ? "Evaluating…" : evaluation ? "Re-evaluate" : "Evaluate opportunity"}
        </button>
      </div>

      <div className="rounded-xl bg-[var(--muted)]/35 p-3 text-xs leading-5 text-[var(--muted-foreground)]">
        This assessment uses deterministic rules, your company profile, normalized opportunity data,
        and persisted solicitation requirements. Missing facts remain unknown; no AI call runs here.
      </div>

      {error ? (
        <div className="flex min-w-0 items-start gap-2 rounded-xl border p-3 text-sm text-red-700">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span className="break-words [overflow-wrap:anywhere]">{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border p-3 text-sm text-[var(--muted-foreground)]">{notice}</div>
      ) : null}

      {evaluation ? (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {statuses.map((status) => {
              const factors = evaluation.factors.filter((factor) => factor.status === status);
              if (!factors.length) return null;
              return (
                <div key={status} className="min-w-0 rounded-xl border p-4">
                  <h3 className="mb-3 text-sm font-semibold">{groupTitle(status)}</h3>
                  <div className="grid min-w-0 gap-3">
                    {factors.map((factor) => (
                      <FactorCard key={factor.key} factor={factor} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="min-w-0 rounded-xl border p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Your decision</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                Your decision is stored separately from the system assessment.
                {decision
                  ? ` Current decision: ${decision.decision.replaceAll("_", " ")}.`
                  : ""}
              </p>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              {(
                [
                  ["pursue", "Pursue"],
                  ["revisit", "Revisit"],
                  ["do_not_pursue", "Do not pursue"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(value)}
                  disabled={pending !== null}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending === value ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
