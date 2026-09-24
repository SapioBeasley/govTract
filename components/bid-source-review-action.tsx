"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { isComplianceEvidence } from "@/lib/bids/compliance";
import type { ComplianceGuidanceContext } from "@/lib/bids/compliance-guidance";
import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";

/**
 * A source finding is never approved by visiting an evidence page or by generating bid
 * text. Prefill only an already pinned original excerpt; server verifies the exact
 * passage against the checksum-matched extraction before recording a human decision.
 */
export function BidSourceReviewAction({
  requirement, context,
}: { requirement: BidWorkspaceRequirement; context: ComplianceGuidanceContext }) {
  const router = useRouter();
  const files = (context.documents ?? []).filter((file) => file.status === "stored" && file.checksumSha256);
  const evidence = isComplianceEvidence(requirement.originalEvidence ?? requirement.evidence)
    ? (requirement.originalEvidence ?? requirement.evidence) : null;
  const references = isComplianceEvidence(evidence) ? evidence.references : [];
  const pinnedReviewChoice = references.find((reference) =>
    reference.excerpt?.trim() && reference.excerpt.trim().length >= 20 &&
    files.some((file) => file.id === reference.snapshotDocumentId &&
      file.opportunityDocumentVersionId === reference.opportunityDocumentVersionId &&
      file.checksumSha256 === reference.checksumSha256));
  const [expanded, setExpanded] = useState(false);
  const [manual, setManual] = useState(!pinnedReviewChoice);
  const [documentVersionId, setDocumentVersionId] = useState(pinnedReviewChoice?.opportunityDocumentVersionId ?? "");
  const [level, setLevel] = useState<"required" | "optional" | "">("");
  const [excerpt, setExcerpt] = useState(pinnedReviewChoice?.excerpt?.trim().slice(0, 480).trim() ?? "");
  const [reviewerNote, setReviewerNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canReview = context.snapshotCurrent && context.sourceReviewAllowed && files.length > 0;
  const selectedFile = files.find((file) => file.opportunityDocumentVersionId === documentVersionId);
  const ready = canReview && confirmed && level && selectedFile &&
    excerpt.trim().length >= 20 && excerpt.length <= 480;

  async function saveReview() {
    if (!ready || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/bids/" + context.workspaceId + "/compliance/" +
        requirement.id + "/source-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentVersionId, level, excerpt,
          reviewerNote: reviewerNote.trim() ||
            ("I checked the retained original and confirmed this buyer requirement is " + level + "."),
          confirmed: true,
        }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "This original could not be verified.");
      } else {
        setMessage("Source confirmed. Now check your saved bid response below.");
        setConfirmed(false);
        router.refresh();
      }
    } catch {
      setMessage("Could not save the source confirmation. Your selection is still here.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 min-w-0 rounded-xl border p-3 text-sm leading-6">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="min-h-11 w-full text-left font-semibold underline underline-offset-2">
        {expanded ? "Hide buyer-source check" : "Check what the original requires"}
      </button>
      {expanded ? (
        <div className="mt-3 grid min-w-0 gap-3">
          {!canReview ? (
            <p role="status">The original source package is missing or changed. Open Source documents
              and technical details below to retrieve or reconcile the originals; this requirement
              cannot be approved without them.</p>
          ) : (
            <>
              <p className="text-sm">
                Is this instruction required by the buyer? Compare the quoted original with
                the full document. This decision does not mark your bid response addressed.
              </p>
              {pinnedReviewChoice && !manual ? (
                <div className="min-w-0 rounded-lg bg-[var(--muted)]/40 p-3">
                  <p className="mb-2 text-xs font-semibold">
                    Original: {selectedFile?.filename ?? pinnedReviewChoice.filename ?? "Retained source"}
                  </p>
                  <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 pl-3 text-xs leading-5">
                    {excerpt}
                  </blockquote>
                  <Link href={"/bids/" + context.workspaceId + "/evidence/" + requirement.id}
                    className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2">
                    Read full original and citation
                  </Link>
                </div>
              ) : null}
              <fieldset className="grid gap-2">
                <legend className="font-semibold">The original says this requirement is:</legend>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border p-2">
                  <input type="radio" name={"source-level-" + requirement.id}
                    checked={level === "required"} onChange={() => { setLevel("required"); setConfirmed(false); }} />
                  Required
                </label>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border p-2">
                  <input type="radio" name={"source-level-" + requirement.id}
                    checked={level === "optional"} onChange={() => { setLevel("optional"); setConfirmed(false); }} />
                  Optional
                </label>
                <p className="text-xs text-[var(--muted-foreground)]">
                  If the original is unclear, leave this unchecked. Do not guess.
                </p>
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmed} className="mt-1 size-5 shrink-0"
                  onChange={(event) => setConfirmed(event.target.checked)} />
                <span>I checked the original buyer instruction and confirm the selected requirement status.</span>
              </label>
              <button type="button" onClick={saveReview} disabled={!ready || saving}
                className="min-h-11 w-fit rounded-lg bg-[var(--primary)] px-4 py-2 font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
                {saving ? "Checking original…" : "Confirm this original"}
              </button>
              <details className="min-w-0 rounded-lg border p-3">
                <summary onClick={() => { setManual(true); setConfirmed(false); }}
                  className="min-h-11 cursor-pointer text-xs font-semibold">
                  Review a different passage or original
                </summary>
                <p className="mt-2 text-xs">
                  If the excerpt above does not establish requiredness, choose another
                  original and paste an exact excerpt. Verification still uses its stored checksum.
                </p>
                <label className="mt-3 grid min-w-0 gap-1 text-xs font-semibold">
                  Current retained original
                  <select value={documentVersionId}
                    onChange={(event) => { setDocumentVersionId(event.target.value); setConfirmed(false); }}
                    className="min-h-11 min-w-0 w-full rounded-lg border bg-white p-2 text-sm">
                    <option value="">Choose the original…</option>
                    {files.map((file) => (
                      <option key={file.id} value={file.opportunityDocumentVersionId}>{file.filename}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 grid min-w-0 gap-1 text-xs font-semibold">
                  Verbatim excerpt from the original (20–480 characters)
                  <textarea value={excerpt} maxLength={480} rows={3}
                    onChange={(event) => { setExcerpt(event.target.value); setConfirmed(false); }}
                    className="min-w-0 rounded-lg border bg-white p-2 text-sm font-normal" />
                </label>
                <label className="mt-3 grid min-w-0 gap-1 text-xs font-semibold">
                  Optional reviewer note
                  <textarea value={reviewerNote} maxLength={2000} rows={2}
                    onChange={(event) => setReviewerNote(event.target.value)}
                    placeholder="Why does this passage establish that the instruction is required or optional?"
                    className="min-w-0 rounded-lg border bg-white p-2 text-sm font-normal" />
                </label>
              </details>
            </>
          )}
          {message ? <p role="status" className="break-words">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
