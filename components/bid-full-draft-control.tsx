"use client";

import { useRef, useState } from "react";

export function BidFullDraftControl({
  workspaceId,
  initialContent,
  sourceBlocker,
}: {
  workspaceId: string;
  initialContent: string | null;
  sourceBlocker: string | null;
}) {
  const inFlight = useRef(false);
  const [content, setContent] = useState(initialContent ?? "");
  const [savedContent, setSavedContent] = useState(initialContent ?? "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = content !== savedContent;

  async function generate() {
    if (inFlight.current || generating || sourceBlocker || dirty) return;
    const replace = Boolean(savedContent.trim());
    if (!window.confirm(replace
      ? "Generate a new full bid and replace the saved draft? This is an explicit AI action and may incur model cost. The current generation remains in audit history."
      : "Generate the full bid from the current retained solicitation package? This is an explicit AI action and may incur model cost.",
    )) return;
    inFlight.current = true;
    setGenerating(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), replace }),
      });
      const body = await response.json() as {
        error?: { message?: string };
        generation?: { applied: boolean; content: string };
      };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Bid generation failed.");
      } else if (!body.generation?.applied) {
        setMessage("The source package or saved draft changed while generation was running. Nothing was overwritten.");
      } else {
        setContent(body.generation.content);
        setSavedContent(body.generation.content);
        setMessage("Full bid generated and saved. Resolve every Needs your input item, then edit the response as needed.");
      }
    } catch {
      setMessage("Bid generation failed. Check the generation history before trying again.");
    } finally {
      inFlight.current = false;
      setGenerating(false);
    }
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Bid could not be saved.");
      } else {
        setSavedContent(content);
        setMessage("Saved. Ordinary edits do not call AI.");
      }
    } catch {
      setMessage("Bid could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="rounded-xl border bg-[var(--muted)]/25 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">Generate the complete response</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              One action uses the current solicitation requirements and relevant retained source evidence to create the editable bid.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={Boolean(sourceBlocker) || dirty || generating}
            className="min-h-11 shrink-0 rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Generating bid…" : <>Generate bid</>}
          </button>
        </div>
        {sourceBlocker ? (
          <div role="status" className="mt-3 rounded-lg border bg-white p-3 text-sm leading-6">
            <p>{sourceBlocker}</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Use Source details below. Retrieve source files or refresh the current source understanding as indicated, then try again.
            </p>
          </div>
        ) : dirty ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Save your current edits before generating a replacement.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="full-bid-content" className="text-sm font-semibold">Editable bid response</label>
          <span className="text-xs text-[var(--muted-foreground)]">
            {dirty ? "Unsaved changes" : savedContent.trim() ? "Saved" : "No draft yet"}
          </span>
        </div>
        <textarea
          id="full-bid-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={28}
          placeholder="Generate the bid to create the first draft, or write a response here manually."
          className="min-h-[32rem] w-full resize-y rounded-xl border bg-white p-4 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="min-h-11 rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <span className="text-xs text-[var(--muted-foreground)]">
            Saving and editing never trigger model generation.
          </span>
        </div>
      </div>
      {message ? <p role="status" className="rounded-lg border p-3 text-sm leading-6">{message}</p> : null}
    </div>
  );
}
