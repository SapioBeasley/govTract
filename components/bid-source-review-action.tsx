"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ComplianceGuidanceContext } from "@/lib/bids/compliance-guidance";
import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

/** Human source determination is separate from bidder compliance completion.
 * Display the stored original and require a verbatim checksum-bound excerpt. */
export function BidSourceReviewAction({
  requirement, context,
}: { requirement: BidWorkspaceRequirement; context: ComplianceGuidanceContext }) {
  const router = useRouter();
  const files = (context.documents ?? []).filter((file) => file.status === "stored" && file.checksumSha256);
  const [expanded, setExpanded] = useState(false);
  const [documentVersionId, setDocumentVersionId] = useState("");
  const [level, setLevel] = useState<"required" | "optional">("required");
  const [excerpt, setExcerpt] = useState("");
  const [reviewerNote, setReviewerNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canReview = context.snapshotCurrent && context.sourceReviewAllowed && files.length > 0;

  async function saveReview() {
    if (!confirmed || !documentVersionId || excerpt.trim().length < 20 ||
        reviewerNote.trim().length < 10 || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${context.workspaceId}/compliance/${requirement.id}/source-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentVersionId, level, excerpt, reviewerNote, confirmed }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Source review could not be verified.");
      else {
        setMessage("Source decision recorded against the retained original; recheck this requirement.");
        setConfirmed(false);
        router.refresh();
      }
    } catch {
      setMessage("Source review could not be saved. Your entered passage and notes remain available.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 min-w-0 rounded-lg border p-3 text-xs leading-5">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="min-h-11 text-left font-semibold underline underline-offset-2">
        {expanded ? "Hide source resolution" : "Resolve source finding using the original"}
      </button>
      {expanded ? (
        <div className="mt-2 grid min-w-0 gap-3">
          <p>
            Reading the evidence page or choosing a response section does not resolve missing source evidence.
            To record a separately audited decision, verify an exact passage from an original retained
            document and state whether this buyer requirement is mandatory. This action never marks the bid Complete.
          </p>
          {!canReview ? (
            <p role="status" className="rounded-lg border p-3">
              Source review is unavailable until the current source package is fully retained and its
              understanding is current. Use Source snapshot to retrieve or reconcile the originals.
              If the cited passage is unavailable in the checksum-matched extraction, it cannot be
              approved here; retrieve or re-extract the original first.
            </p>
          ) : (
            <>
              <label className="grid gap-1 font-semibold">
                Current retained original
                <select value={documentVersionId} onChange={(event) => { setDocumentVersionId(event.target.value); setConfirmed(false); }}
                  className="min-h-11 min-w-0 w-full rounded-lg border bg-white p-2 text-sm">
                  <option value="">Choose the source file with the exact buyer instruction…</option>
                  {files.map((file) => (
                    <option key={file.id} value={file.opportunityDocumentVersionId}>{file.filename}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 font-semibold">
                Requiredness in the original
                <select value={level} onChange={(event) => { setLevel(event.target.value as "required" | "optional"); setConfirmed(false); }}
                  className="min-h-11 min-w-0 w-full rounded-lg border bg-white p-2 text-sm">
                  <option value="required">Required by the buyer</option>
                  <option value="optional">Optional in the buyer's instructions</option>
                </select>
              </label>
              <label className="grid gap-1 font-semibold">
                Verbatim excerpt from this original (20–480 characters)
                <textarea value={excerpt} maxLength={480} rows={3}
                  onChange={(event) => { setExcerpt(event.target.value); setConfirmed(false); }}
                  placeholder="Paste the exact passage from the original document, including mandatory/optional wording when available."
                  className="min-w-0 rounded-lg border bg-white p-2 text-sm font-normal" />
              </label>
              <label className="grid gap-1 font-semibold">
                Reviewer rationale (10–2,000 characters)
                <textarea value={reviewerNote} maxLength={2000} rows={2}
                  onChange={(event) => { setReviewerNote(event.target.value); setConfirmed(false); }}
                  placeholder="Explain what this quoted instruction establishes for this buyer requirement."
                  className="min-w-0 rounded-lg border bg-white p-2 text-sm font-normal" />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={confirmed} className="mt-1 size-4 shrink-0"
                  onChange={(event) => setConfirmed(event.target.checked)} />
                <span>I reviewed this retained original, confirmed that its quoted instruction
                  supports my requiredness decision, and understand that my bid response requires separate review.</span>
              </label>
              <button type="button" onClick={saveReview}
                disabled={saving || !confirmed || !documentVersionId || excerpt.trim().length < 20 || reviewerNote.trim().length < 10}
                className="min-h-11 w-fit rounded-lg bg-[var(--primary)] px-4 py-2 font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
                {saving ? "Verifying source…" : "Record source review"}
              </button>
            </>
          )}
          {message ? <p role="status" className="break-words">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
