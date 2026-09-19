"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { COMPLIANCE_STATUSES, isComplianceEvidence, type ComplianceStatus } from "@/lib/bids/compliance";
import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

const LABELS: Record<ComplianceStatus, string> = {
  missing: "Missing",
  drafting: "Drafting",
  complete: "Complete",
  needs_review: "Needs Review",
  not_applicable: "Not Applicable",
};

function ComplianceRow({
  workspaceId,
  requirement,
  sourceReady,
}: {
  workspaceId: string;
  requirement: BidWorkspaceRequirement;
  sourceReady: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(requirement.status);
  const [notes, setNotes] = useState(requirement.responseNotes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const evidence = isComplianceEvidence(requirement.evidence) ? requirement.evidence : null;
  const canComplete = sourceReady && requirement.canMarkComplete;

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/compliance/${requirement.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, responseNotes: notes.trim() || null }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Requirement could not be saved.");
      } else {
        setMessage("Saved.");
        router.refresh();
      }
    } catch {
      setMessage("Requirement could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const changed = status !== requirement.status || notes !== (requirement.responseNotes ?? "");

  return (
    <article className="min-w-0 rounded-xl border p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
        <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 capitalize">
          {requirement.requirementType.replaceAll("_", " ")}
        </span>
        <span className="rounded-full border px-2.5 py-1">
          {requirement.isRequired ? "Required" : "Optional"}
        </span>
        {requirement.effectiveStatus === "needs_review" ? (
          <span className="rounded-full border px-2.5 py-1">Needs source review</span>
        ) : null}
      </div>
      <p className="mt-3 min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {requirement.text}
      </p>
      {evidence ? (
        <div className="mt-2 min-w-0 text-xs leading-5 text-[var(--muted-foreground)]">
          {evidence.references.length ? (
            <p className="break-words [overflow-wrap:anywhere]">
              Source: {evidence.references.map((reference) =>
                `${reference.filename ?? "Unmatched source document"}${typeof reference.locator.page === "number" ? `, p. ${reference.locator.page}` : ""}`
              ).join("; ")}
            </p>
          ) : <p>No evidence has been attached to this requirement.</p>}
          {evidence.issues.length ? (
            <p className="mt-1 break-words [overflow-wrap:anywhere]">
              Evidence warnings at generation: {evidence.issues.map((issue) => issue.replaceAll("_", " ")).join("; ")}.
            </p>
          ) : null}
          <Link
            href={`/bids/${workspaceId}/evidence/${requirement.id}`}
            className="mt-1 inline-block font-semibold underline underline-offset-2"
          >
            View pinned document/version evidence
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Source evidence is missing; review this requirement before completing.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <label className="min-w-0 text-xs font-medium">
          Response status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-2 text-sm"
          >
            {COMPLIANCE_STATUSES.map((value) => (
              <option key={value} value={value} disabled={value === "complete" && !canComplete}>
                {LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">
          Response notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={10_000}
            rows={2}
            placeholder="Owner, draft location, missing documents, review findings…"
            className="mt-1.5 block w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!changed || pending} onClick={save}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Saving…" : "Save requirement"}
        </button>
        {message ? <span className="text-xs text-[var(--muted-foreground)]">{message}</span> : null}
      </div>
    </article>
  );
}

export function ComplianceMatrixControl({
  workspaceId,
  requirements,
  sourceAvailable,
  sourceReady,
}: {
  workspaceId: string;
  requirements: BidWorkspaceRequirement[];
  sourceAvailable: boolean;
  sourceReady: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/compliance`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Compliance matrix could not be generated.");
      } else {
        router.refresh();
      }
    } catch {
      setMessage("Compliance matrix could not be generated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          {requirements.length} bid requirement{requirements.length === 1 ? "" : "s"}.
          {sourceReady
            ? " Statuses are tracked separately from the authoritative solicitation."
            : " Source coverage is incomplete or changed; verify affected requirements before completion."}
        </p>
        <button type="button" onClick={generate} disabled={pending || !sourceAvailable}
          className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Preparing…" : requirements.length ? "Add newly extracted requirements" : "Generate compliance matrix"}
        </button>
      </div>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {requirements.length ? (
        <div className="grid min-w-0 gap-3">
          {requirements.map((requirement) => (
            <ComplianceRow key={requirement.id} workspaceId={workspaceId}
              requirement={requirement} sourceReady={sourceReady} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
          {sourceAvailable
            ? "Generate a bid response checklist from the persisted solicitation requirements. No AI regeneration is needed."
            : "No structured requirements are available. Finish solicitation understanding before generating the compliance matrix."}
        </p>
      )}
    </div>
  );
}
