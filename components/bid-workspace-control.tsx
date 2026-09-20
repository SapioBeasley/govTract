"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  BID_WORKSPACE_REVIEW_STATES,
  BID_WORKSPACE_STATUSES,
  type BidWorkspaceReviewState,
  type BidWorkspaceStatus,
} from "@/lib/bids/workspace-types";

const STATUS_LABELS: Record<BidWorkspaceStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  complete: "Draft complete (internal)",
};

const REVIEW_LABELS: Record<BidWorkspaceReviewState, string> = {
  not_started: "Not started",
  in_review: "In review",
  needs_changes: "Needs changes",
  approved: "Approved",
};

export function BidWorkspaceControl({
  workspaceId,
  initialStatus,
  initialReviewState,
  initialNotes,
}: {
  workspaceId: string;
  initialStatus: BidWorkspaceStatus;
  initialReviewState: BidWorkspaceReviewState;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [reviewState, setReviewState] = useState(initialReviewState);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasChanges = useMemo(
    () =>
      status !== initialStatus ||
      reviewState !== initialReviewState ||
      notes !== (initialNotes ?? ""),
    [status, reviewState, notes, initialStatus, initialReviewState, initialNotes],
  );

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          reviewState,
          notes: notes.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setMessage(payload?.error?.message ?? "Workspace could not be updated.");
        return;
      }
      setMessage("Workspace updated.");
      router.refresh();
    } catch {
      setMessage("Workspace could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Workspace status
          </span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as BidWorkspaceStatus)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            {BID_WORKSPACE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Review state
          </span>
          <select
            value={reviewState}
            onChange={(event) => setReviewState(event.target.value as BidWorkspaceReviewState)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            {BID_WORKSPACE_REVIEW_STATES.map((value) => (
              <option key={value} value={value} disabled={value === "approved"}>
                {REVIEW_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--muted-foreground)]">Approve only in Final review after checking the current source package.</span>
        </label>
      </div>

      <label>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Workspace notes
        </span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Bid strategy, assignments, review notes, unanswered questions…"
          className="mt-1.5 w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !hasChanges}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {pending ? "Saving…" : "Save workspace"}
        </button>
        {message ? (
          <span className="break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
