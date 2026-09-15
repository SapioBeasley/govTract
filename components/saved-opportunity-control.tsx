"use client";

import { Check, Heart, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  SAVED_OPPORTUNITY_STATUSES,
  type SavedOpportunityStatus,
  type SavedOpportunitySnapshotStatus,
} from "@/lib/opportunities/saved-types";

export type SavedOpportunityClientState = {
  status: SavedOpportunityStatus;
  notes: string | null;
  priority: number;
  internalDeadline: string | null;
  snapshotStatus: SavedOpportunitySnapshotStatus;
};

type ApiPayload = {
  saved?: SavedOpportunityClientState | null;
  error?: { message?: string };
};

type RequestResult = {
  ok: boolean;
  saved: SavedOpportunityClientState | null;
};

const STATUS_LABELS: Record<SavedOpportunityStatus, string> = {
  saved: "Saved",
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  no_bid: "No Bid",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function snapshotLabel(status: SavedOpportunitySnapshotStatus) {
  if (status === "complete") return "Snapshot complete";
  if (status === "blocked") return "Snapshot blocked";
  if (status === "incomplete") return "Snapshot incomplete";
  return "Snapshot not required";
}

export function SavedOpportunityControl({
  opportunityId,
  initialSaved,
  compact = false,
}: {
  opportunityId: string;
  initialSaved: SavedOpportunityClientState | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [status, setStatus] = useState<SavedOpportunityStatus>(initialSaved?.status ?? "saved");
  const [notes, setNotes] = useState(initialSaved?.notes ?? "");
  const [priority, setPriority] = useState(initialSaved?.priority ?? 0);
  const [internalDeadline, setInternalDeadline] = useState(
    toLocalInput(initialSaved?.internalDeadline ?? null),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    if (!saved) return false;
    return (
      status !== saved.status ||
      notes !== (saved.notes ?? "") ||
      priority !== saved.priority ||
      internalDeadline !== toLocalInput(saved.internalDeadline)
    );
  }, [saved, status, notes, priority, internalDeadline]);

  async function request(
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<RequestResult> {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/saved`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok) {
        setMessage(payload?.error?.message ?? "Saved opportunity could not be updated.");
        return { ok: false, saved };
      }
      const nextSaved = payload?.saved ?? null;
      setSaved(nextSaved);
      if (nextSaved) {
        setStatus(nextSaved.status);
        setNotes(nextSaved.notes ?? "");
        setPriority(nextSaved.priority);
        setInternalDeadline(toLocalInput(nextSaved.internalDeadline));
      }
      router.refresh();
      return { ok: true, saved: nextSaved };
    } catch {
      setMessage("Saved opportunity could not be updated.");
      return { ok: false, saved };
    } finally {
      setPending(false);
    }
  }

  async function save() {
    const result = await request("POST");
    if (result.ok && result.saved) setMessage("Opportunity saved.");
  }

  async function update() {
    const isoDeadline = internalDeadline ? new Date(internalDeadline).toISOString() : null;
    const result = await request("PATCH", {
      status,
      notes: notes.trim() || null,
      priority,
      internalDeadline: isoDeadline,
    });
    if (result.ok && result.saved) setMessage("Pursuit details saved.");
  }

  async function remove() {
    const result = await request("DELETE");
    if (result.ok && result.saved === null) {
      setStatus("saved");
      setNotes("");
      setPriority(0);
      setInternalDeadline("");
      setMessage("Removed from Saved.");
    }
  }

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={saved ? undefined : save}
          disabled={pending || Boolean(saved)}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] disabled:cursor-default disabled:opacity-80"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" />
          ) : (
            <Heart className="size-4" />
          )}
          {saved ? STATUS_LABELS[saved.status] : "Save"}
        </button>
        {message ? <span className="text-xs text-[var(--muted-foreground)]">{message}</span> : null}
      </div>
    );
  }

  if (!saved) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Heart className="size-4" />}
          Save opportunity
        </button>
        {message ? <p className="text-xs text-[var(--muted-foreground)]">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-xl border bg-[var(--muted)]/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Pursuit pipeline</div>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">
            {snapshotLabel(saved.snapshotStatus)}
            {saved.status === "pursuing" && saved.snapshotStatus === "incomplete"
              ? " · #95 will retain the authoritative source files."
              : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-[var(--muted-foreground)] hover:bg-white hover:text-[var(--foreground)] disabled:opacity-60"
        >
          <Trash2 className="size-4" /> Remove
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as SavedOpportunityStatus)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            {SAVED_OPPORTUNITY_STATUSES.map((value) => (
              <option key={value} value={value}>{STATUS_LABELS[value]}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          >
            <option value={0}>None</option>
            <option value={1}>1 · Low</option>
            <option value={2}>2</option>
            <option value={3}>3 · Medium</option>
            <option value={4}>4</option>
            <option value={5}>5 · High</option>
          </select>
        </label>

        <label>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Internal deadline</span>
          <input
            type="datetime-local"
            value={internalDeadline}
            onChange={(event) => setInternalDeadline(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
          />
        </label>
      </div>

      <label>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="Decision notes, follow-ups, teaming questions, pricing reminders…"
          className="mt-1.5 w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={update}
          disabled={pending || !hasChanges}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save changes
        </button>
        {message ? <span className="text-xs text-[var(--muted-foreground)]">{message}</span> : null}
      </div>
    </div>
  );
}
