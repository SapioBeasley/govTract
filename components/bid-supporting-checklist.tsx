"use client";

import { useState } from "react";

type ChecklistItem = {
  id: string;
  requirementKey: string;
  label: string;
  kind: string;
  required: boolean;
  conditional: boolean;
  originalForm: boolean;
  action: "external_attachment";
  sourceFiles: string[];
  listingSource: boolean;
  ready: boolean;
  applicable: boolean;
  blocking: boolean;
};

type ChecklistView = {
  fingerprint: string;
  stateCurrent: boolean;
  sourceCurrent: boolean;
  readyForPackage: boolean;
  blockingItemIds: string[];
  readyItemIds: string[];
  applicableItemIds: string[];
  items: ChecklistItem[];
};

export function BidSupportingChecklist({
  workspaceId,
  initialChecklist,
}: {
  workspaceId: string;
  initialChecklist: ChecklistView;
}) {
  const [checklist, setChecklist] = useState(initialChecklist);
  const [pendingItem, setPendingItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function update(itemId: string, change: { ready?: boolean; applicable?: boolean }) {
    if (pendingItem) return;
    setPendingItem(itemId);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/supporting-items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, ...change }),
      });
      const body = await response.json() as {
        checklist?: ChecklistView;
        error?: { message?: string };
      };
      if (!response.ok || !body.checklist) {
        setMessage(body.error?.message ?? "Supporting item could not be saved.");
      } else {
        setChecklist(body.checklist);
        setMessage("Supporting material status saved.");
      }
    } catch {
      setMessage("Supporting item could not be saved.");
    } finally {
      setPendingItem(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">Supporting materials</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
            These are separate items the solicitation says may need to accompany the bid. Check an item only when you have it ready to provide.
          </p>
        </div>
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium">
          {checklist.readyForPackage ? "Supporting items ready" : `${checklist.blockingItemIds.length} needed`}
        </span>
      </div>

      {!checklist.sourceCurrent ? (
        <div role="status" className="rounded-xl border p-4 text-sm leading-6">
          The solicitation source changed. Refresh the current source package before updating supporting material status.
        </div>
      ) : null}

      {!checklist.items.length ? (
        <div className="rounded-xl border border-dashed p-4 text-sm leading-6 text-[var(--muted-foreground)]">
          No separate supporting attachments were identified in the current solicitation requirements.
        </div>
      ) : (
        <div className="grid gap-3">
          {checklist.items.map((item) => {
            const disabled = !checklist.sourceCurrent || pendingItem === item.id;
            return (
              <article key={item.id} className="min-w-0 rounded-xl border p-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2 text-xs font-medium">
                      <span className="rounded-full bg-[var(--muted)] px-2 py-1">
                        {item.required ? "Required" : "Conditional"}
                      </span>
                      {item.originalForm ? (
                        <span className="rounded-full border px-2 py-1">Buyer-provided original form</span>
                      ) : null}
                    </div>
                    <p className="mt-2 break-words text-sm font-semibold leading-6">{item.label}</p>
                    {item.originalForm ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                        Use the original worksheet/form supplied by the buyer; do not replace it with generated prose.
                      </p>
                    ) : null}
                    <details className="mt-2 text-xs text-[var(--muted-foreground)]">
                      <summary className="cursor-pointer font-medium">Source reference</summary>
                      <p className="mt-1 break-all">Requirement: {item.requirementKey}</p>
                      {item.sourceFiles.length ? (
                        <p className="mt-1 break-words">Source file: {item.sourceFiles.join(", ")}</p>
                      ) : item.listingSource ? (
                        <p className="mt-1">Source: authoritative opportunity listing</p>
                      ) : null}
                    </details>
                  </div>
                  <div className="grid shrink-0 gap-2 sm:min-w-52">
                    {item.conditional ? (
                      <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={item.applicable}
                          disabled={disabled}
                          onChange={(event) => update(item.id, { applicable: event.target.checked })}
                          className="size-4"
                        />
                        Applies to this bid
                      </label>
                    ) : null}
                    <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={item.ready}
                        disabled={disabled || (item.conditional && !item.applicable)}
                        onChange={(event) => update(item.id, { ready: event.target.checked })}
                        className="size-4"
                      />
                      I have/provided this
                    </label>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
                  Keep this supporting file ready for the external procurement system or buyer portal. govTract records only your readiness status here.
                </p>
              </article>
            );
          })}
        </div>
      )}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
