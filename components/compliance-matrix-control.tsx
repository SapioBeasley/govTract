"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { COMPLIANCE_STATUSES, isComplianceEvidence, type ComplianceStatus } from "@/lib/bids/compliance";
import { explainComplianceRequirement, type ComplianceGuidanceContext } from "@/lib/bids/compliance-guidance";
import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

const LABELS: Record<ComplianceStatus, string> = {
  missing: "Not addressed",
  drafting: "Working on it",
  complete: "Complete — addressed in my bid",
  needs_review: "Needs clarification or review",
  not_applicable: "Not applicable (verify against source)",
};

function ComplianceRow({
  requirement,
  context,
}: {
  requirement: BidWorkspaceRequirement;
  context: ComplianceGuidanceContext;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(requirement.status);
  const [notes, setNotes] = useState(requirement.responseNotes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const guidance = explainComplianceRequirement(requirement, context);
  const evidence = isComplianceEvidence(requirement.evidence) ? requirement.evidence : null;

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${context.workspaceId}/compliance/${requirement.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, responseNotes: notes.trim() || null }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Requirement could not be saved.");
      } else {
        setMessage("Saved. Recheck the current source and final-review status.");
        router.refresh();
      }
    } catch {
      setMessage("Requirement could not be saved. Your unsaved response notes are still here.");
    } finally {
      setPending(false);
    }
  }

  const changed = status !== requirement.status || notes !== (requirement.responseNotes ?? "");
  const statusDescription = guidance.kind === "blocked" ? "Source verification needed" :
    guidance.kind === "addressed" ? "Addressed in your bid" :
      requirement.effectiveStatus === "not_applicable" ? "Marked not applicable — verify" :
        "Your response needs action";

  return (
    <article id={`compliance-requirement-${requirement.id}`}
      className="min-w-0 scroll-mt-5 rounded-xl border p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
        <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 capitalize">
          {requirement.requirementType.replaceAll("_", " ")}
        </span>
        <span className="rounded-full border px-2.5 py-1">
          {evidence?.requirementLevel === "unknown" ? "Mandatory status unverified" :
            requirement.isRequired ? "Required" : "Optional"}
        </span>
        <span className="rounded-full border px-2.5 py-1">{statusDescription}</span>
      </div>
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        What the buyer asks
      </h3>
      <p className="mt-1 min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {requirement.text}
      </p>
      {evidence ? (
        <p className="mt-2 min-w-0 break-words text-xs leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
          Original source: {evidence.references.length ?
            evidence.references.map((reference) =>
              `${reference.filename ?? "Unmatched original"}${typeof reference.locator.page === "number" ? `, page ${reference.locator.page}` : ""}`).join("; ") :
            evidence.listingEvidence ? "Authoritative opportunity listing" : "No pinned original excerpt"}
        </p>
      ) : null}

      <div role={guidance.kind === "blocked" ? "status" : undefined}
        className="mt-3 min-w-0 rounded-lg border bg-[var(--muted)]/35 p-3 text-sm leading-6">
        <p className="font-semibold">
          {guidance.kind === "blocked" ? "Why Complete is disabled" : "What this status means"}
        </p>
        <p className="mt-1 break-words [overflow-wrap:anywhere]">{guidance.explanation}</p>
        <p className="mt-2 break-words [overflow-wrap:anywhere]">
          <strong>Next:</strong> {guidance.nextAction}
        </p>
        <Link href={guidance.link.href} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
          {guidance.link.label}
        </Link>
        {guidance.kind === "blocked" && evidence ? (
          <Link href={`/bids/${context.workspaceId}/evidence/${requirement.id}`}
            className="ml-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
            View pinned document evidence
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <label className="min-w-0 text-xs font-semibold">
          My bid response
          <select value={status} onChange={(event) => setStatus(event.target.value)}
            className="mt-1.5 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm">
            {COMPLIANCE_STATUSES.map((value) => (
              <option key={value} value={value} disabled={value === "complete" && !guidance.canComplete}>
                {LABELS[value]}
              </option>
            ))}
          </select>
          {guidance.kind === "blocked" ? (
            <span className="mt-1 block text-xs font-normal">
              You can still save notes or mark this item Working on it; only Complete requires current verified source evidence.
            </span>
          ) : null}
          {requirement.status === "complete" && requirement.effectiveStatus !== "complete" ? (
            <span className="mt-1 block text-xs font-normal">
              Previously saved Complete, but this is not currently accepted by final review. Resolve the source issue.
            </span>
          ) : null}
        </label>
        <label className="min-w-0 text-xs font-semibold">
          Where my bid addresses it / what remains
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)}
            maxLength={10_000} rows={3}
            placeholder="Example: Technical response, paragraph 2. Still need supplier certificate and signed original form."
            className="mt-1.5 block w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm font-normal" />
          <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">
            Record your response location and outstanding work. Notes do not replace required forms or source evidence.
          </span>
        </label>
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">
        <button type="button" disabled={!changed || pending} onClick={save}
          className="min-h-11 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Saving…" : "Save my response status"}
        </button>
        {message ? <span role="status" className="min-w-0 break-words text-xs">{message}</span> : null}
      </div>
    </article>
  );
}

type Filter = "all" | "actionable" | "blocked" | "addressed";

export function ComplianceMatrixControl({
  workspaceId,
  requirements,
  sourceAvailable,
  context,
}: {
  workspaceId: string;
  requirements: BidWorkspaceRequirement[];
  sourceAvailable: boolean;
  context: ComplianceGuidanceContext;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/compliance`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Checklist could not be updated.");
      else {
        setMessage("Checklist refreshed from saved source evidence; prior responses were preserved.");
        router.refresh();
      }
    } catch {
      setMessage("Checklist could not be updated. Saved responses were not overwritten.");
    } finally {
      setPending(false);
    }
  }

  const rows = requirements.map((requirement) => ({
    requirement, guidance: explainComplianceRequirement(requirement, context),
  }));
  const counts = {
    all: rows.length,
    actionable: rows.filter(({ guidance }) => guidance.kind === "actionable").length,
    blocked: rows.filter(({ guidance }) => guidance.kind === "blocked").length,
    addressed: rows.filter(({ guidance }) => guidance.kind === "addressed").length,
  };
  const visible = filter === "all" ? rows : rows.filter(({ guidance }) => guidance.kind === filter);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="min-w-0 rounded-xl border bg-[var(--muted)]/35 p-4 text-sm leading-6">
        <h3 className="font-semibold">How to use this checklist</h3>
        <p className="mt-1">
          Each card is a requirement from the buyer's solicitation. Review the original source,
          prepare the matching bid response or form, and record where you addressed it.
          Choose <strong>Complete</strong> only after your bid actually addresses that verified requirement.
        </p>
        <p className="mt-2">
          If Complete is disabled, read the reason and use the linked source-recovery action.
          You can still save work-in-progress notes. Checking off a requirement does not verify
          vendor claims, original signatures, or final portal submission.
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{requirements.length} buyer requirement{requirements.length === 1 ? "" : "s"}</p>
        <button type="button" onClick={generate} disabled={pending || !sourceAvailable}
          className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Updating…" : requirements.length ? "Add newly extracted requirements" : "Build requirement checklist"}
        </button>
      </div>
      {message ? <p role="status" className="min-w-0 break-words text-sm">{message}</p> : null}
      {requirements.length ? (
        <>
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Filter bid requirements">
            {([
              ["all", "All"],
              ["actionable", "My next responses"],
              ["blocked", "Source verification needed"],
              ["addressed", "Addressed"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${filter === value ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-white"}`}>
                {label} ({counts[value]})
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            Source verification needed is not the same as unfinished bid writing. Reopen affected originals before marking those rows Complete.
          </p>
          <div className="grid min-w-0 gap-3">
            {visible.map(({ requirement }) => (
              <ComplianceRow key={requirement.id} requirement={requirement} context={context} />
            ))}
            {!visible.length ? <p className="rounded-lg border border-dashed p-4 text-sm">No requirements in this view. Choose All to see every saved item.</p> : null}
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
          {sourceAvailable ? "Build a requirement checklist from the saved solicitation evidence. This does not call AI."
            : "No structured requirements are available. Finish solicitation understanding before building this checklist."}
        </p>
      )}
    </div>
  );
}
