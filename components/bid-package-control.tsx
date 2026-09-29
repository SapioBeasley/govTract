"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import type { BidWorkspaceSection } from "@/lib/bids/workspace";

export function BidPackageControl({
  workspaceId,
  initialSections,
  sourceReady,
  sourceBlockers,
}: {
  workspaceId: string;
  initialSections: BidWorkspaceSection[];
  sourceReady: boolean;
  sourceBlockers: string[];
}) {
  const router = useRouter();
  const fullBid = useMemo(
    () => initialSections.find((section) => section.metadata.fullBid === true) ?? null,
    [initialSections],
  );
  const [content, setContent] = useState(fullBid?.content ?? "");
  const [savedContent, setSavedContent] = useState(fullBid?.content ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const changed = content !== savedContent;

  async function generate() {
    if (!sourceReady || pending || inFlight.current) return;
    const replace = Boolean(fullBid?.content?.trim());
    if (!window.confirm(replace
      ? "Regenerate the full bid? This is an explicit AI action that may incur model cost and replace the saved generated response. Your prior generation remains in audit history."
      : "Generate the full bid from the retained solicitation package? This is an explicit AI action that may incur model cost. Unknown vendor/company/product facts will remain marked Needs your input.",
    )) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), replace }),
      });
      const payload = await response.json() as {
        error?: { message?: string };
        generation?: { applied?: boolean };
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Bid generation failed.");
      } else if (!payload.generation?.applied) {
        setMessage("The solicitation changed while the bid was generating. No saved response was overwritten.");
      } else {
        setMessage("Bid generated. Review and edit the saved response, then supply the supporting documents below.");
        router.refresh();
      }
    } catch {
      setMessage("Bid generation failed. No saved response was overwritten.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function save() {
    if (!fullBid || !changed || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/outline/${fullBid.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Bid changes could not be saved.");
      } else {
        setSavedContent(content);
        setMessage("Saved.");
        router.refresh();
      }
    } catch {
      setMessage("Bid changes could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-xl border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Generate the bid</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              govTract uses the current retained solicitation package and source-backed requirements to create one editable response.
              Missing company, product, pricing, certification, staffing, insurance, signature, or other bidder facts stay as Needs your input.
            </p>
          </div>
          <button type="button" onClick={generate} disabled={!sourceReady || pending || changed}
            className="shrink-0 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
            {pending ? "Working…" : fullBid?.content?.trim() ? "Regenerate bid" : "Generate bid"}
          </button>
        </div>
        {!sourceReady ? (
          <p role="status" className="mt-3 text-sm text-[var(--muted-foreground)]">
            {sourceBlockers[0] ?? "The retained solicitation package is not ready for generation yet."}
          </p>
        ) : changed ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">Save your current edits before regenerating.</p>
        ) : null}
      </div>

      {fullBid ? (
        <div className="rounded-xl border p-4">
          <label htmlFor="full-bid-response" className="font-semibold">Full bid response</label>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            Edit this response directly. Ordinary editing and saving never invoke AI.
          </p>
          <textarea id="full-bid-response" value={content} onChange={(event) => setContent(event.target.value)}
            className="mt-3 min-h-[36rem] w-full rounded-lg border bg-white p-3 text-sm leading-6"
            spellCheck />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!changed || pending}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">
              {pending ? "Saving…" : "Save bid"}
            </button>
            {/\[NEEDS INPUT:/i.test(content) ? (
              <span className="text-xs font-medium">Needs your input remains in this draft before package approval.</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
          Generate the bid to create the editable response.
        </div>
      )}

      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
