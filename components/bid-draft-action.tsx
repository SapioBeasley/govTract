"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { BidDraftGenerationSummary } from "@/lib/bids/draft-persistence";

export function BidDraftAction({
  workspaceId,
  sectionId,
  currentContent,
  sourceReady,
  sourceBlockers,
  unsavedChanges,
  generations,
}: {
  workspaceId: string;
  sectionId: string;
  currentContent: string | null;
  sourceReady: boolean;
  sourceBlockers: string[];
  unsavedChanges: boolean;
  generations: BidDraftGenerationSummary[];
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const relevant = generations.filter((generation) => generation.bidSectionId === sectionId);
  const last = relevant[0] ?? null;

  async function generate() {
    if (inFlight.current || unsavedChanges || !sourceReady) return;
    const replace = Boolean(currentContent?.trim());
    if (!window.confirm(replace
      ? "Manually regenerate this section? This may incur a paid AI charge and will replace the saved response if sources and section are unchanged. Your previous generation remains in history. The server enforces the configured budget."
      : "Manually draft this section with AI? This may incur a paid AI charge. The server enforces the configured budget. You must check every claim and save a reviewed response before final approval.",
    )) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/outline/${sectionId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), replace }),
      });
      const body = await response.json() as {
        error?: { message?: string };
        generation?: { state: string; applied: boolean };
      };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Manual AI draft failed.");
      } else {
        setMessage(body.generation?.applied
          ? "Draft saved. Review the source and missing-fact placeholders before submission."
          : "The source or section changed during drafting. The generated output was recorded but your saved section was not overwritten.");
        router.refresh();
      }
    } catch {
      setMessage("Manual AI draft failed. Check generation history before trying again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button type="button" onClick={generate}
          disabled={!sourceReady || unsavedChanges || pending}
          className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Generating manual draft…" : currentContent?.trim() ? "Regenerate with AI" : "Draft with AI"}
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          User-triggered only · each click may incur model cost · human review required
        </span>
      </div>
      {!sourceReady ? (
        <div role="status" className="grid gap-1 text-xs leading-5 text-[var(--muted-foreground)]">
          <p>Draft with AI is blocked by source verification:</p>
          {sourceBlockers.length ? sourceBlockers.map((reason,index) => (
            <p key={index} className="break-words">{reason}</p>
          )) : <p>Review the complete current source package and section evidence before drafting.</p>}
        </div>
      ) : unsavedChanges ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Save your manual section changes before requesting an AI draft.
        </p>
      ) : null}
      {message ? <p role="status" className="break-words text-xs">{message}</p> : null}
      {last ? (
        <details className="min-w-0 text-xs text-[var(--muted-foreground)]">
          <summary className="cursor-pointer">
            Draft generation history · {relevant.length} manual request{relevant.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 grid gap-2">
            {relevant.map((generation) => (
              <div key={generation.id} className="min-w-0 rounded-lg bg-[var(--muted)]/40 p-2">
                <p className="break-words">
                  {new Date(generation.createdAt).toLocaleString()} · {generation.modelProvider}/{generation.modelName}
                  {generation.modelVersion ? ` (${generation.modelVersion})` : ""}
                  {" · "}{generation.status}{generation.applied ? " · applied to section" : " · not applied"}
                </p>
                <p className="break-all">Input fingerprint: {generation.inputFingerprint}</p>
                <p className="break-all">Document set: {generation.documentSetFingerprint}</p>
                <p className="break-words">
                  Versions: {generation.documentVersions.map((version) =>
                    `${version.filename} (${version.versionId})`).join(", ")}
                </p>
                <p>
                  {generation.inputTokenCount ?? "?"} input / {generation.outputTokenCount ?? "?"} output tokens
                  {" · "}Estimated cost: {generation.estimatedCostMicrousd === null
                    ? "unknown" : `$${(generation.estimatedCostMicrousd / 1_000_000).toFixed(6)}`}
                  {" · "}Recorded cost: {generation.actualCostMicrousd === null
                    ? "unknown" : `$${(generation.actualCostMicrousd / 1_000_000).toFixed(6)}`}
                </p>
                {generation.failureCode ? <p>Warning: {generation.failureCode.replaceAll("_", " ")}</p> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
