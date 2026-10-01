"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function BidWorkspaceControl({
  workspaceId,
  initialNotes,
}: {
  workspaceId: string;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasChanges = useMemo(
    () => notes !== (initialNotes ?? ""),
    [notes, initialNotes],
  );

  async function save() {
    if (!hasChanges || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || null }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setMessage(payload?.error?.message ?? "Workspace notes could not be updated.");
        return;
      }
      setMessage("Workspace notes saved.");
      router.refresh();
    } catch {
      setMessage("Workspace notes could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div>
        <h3 className="font-semibold">Workspace notes</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
          Bid status is derived from unresolved inputs, the saved draft, package approval, and explicit external submission confirmation.
          Notes remain available here without creating a second workflow state.
        </p>
      </div>
      <label>
        <span className="sr-only">Workspace notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Bid strategy, assignments, review notes, unanswered questions…"
          className="w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm"
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
          {pending ? "Saving…" : "Save notes"}
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
