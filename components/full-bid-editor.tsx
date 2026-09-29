"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type SupportingItem = {
  requirementId: string;
  text: string;
  kind: string;
  mandatory: boolean;
  originalConfirmed: boolean;
};

type Props = {
  workspaceId: string;
  sectionId: string | null;
  initialContent: string;
  generationBlockers: string[];
  supportingItems: SupportingItem[];
  confirmedSupportingItems: string[];
  readyForHumanReview: boolean;
  approvalCurrent: boolean;
};

export function FullBidEditor({
  workspaceId,
  sectionId,
  initialContent,
  generationBlockers,
  supportingItems,
  confirmedSupportingItems,
  readyForHumanReview,
  approvalCurrent,
}: Props) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [confirmed, setConfirmed] = useState(confirmedSupportingItems);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<"generate" | "save" | "support" | "approve" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setContent(initialContent), [initialContent]);
  useEffect(() => setConfirmed(confirmedSupportingItems), [confirmedSupportingItems]);

  const changed = content !== initialContent;
  const confirmationsChanged = [...confirmed].sort().join("|") !==
    [...confirmedSupportingItems].sort().join("|");
  const needsInput = useMemo(
    () => (content.match(/\[(?:NEEDS\s+INPUT|TODO|TBD|INSERT|PLACEHOLDER)[^\]]*\]/gi) ?? []).length,
    [content],
  );

  async function request(url: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "The bid could not be updated.");
  }

  async function generate() {
    setPending("generate");
    setMessage(null);
    try {
      await request(`/api/bids/${workspaceId}/draft`, "POST", { requestId: crypto.randomUUID() });
      setMessage("Bid generated and saved. Review every Needs your input item before approval.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bid could not be generated.");
    } finally {
      setPending(null);
    }
  }

  async function save() {
    if (!sectionId) return;
    setPending("save");
    setMessage(null);
    try {
      await request(`/api/bids/${workspaceId}/outline/${sectionId}`, "PATCH", { content });
      setMessage("Draft saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function saveSupporting() {
    setPending("support");
    setMessage(null);
    try {
      await request(`/api/bids/${workspaceId}`, "PATCH", { confirmedOriginalForms: confirmed });
      setMessage("Supporting-document checklist saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supporting-document checklist could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function approve() {
    setPending("approve");
    setMessage(null);
    try {
      await request(`/api/bids/${workspaceId}`, "PATCH", {
        reviewState: "approved",
        humanReviewConfirmed: true,
      });
      setMessage("Current saved bid package approved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bid package could not be approved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Bid draft</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
              Generate one complete draft from the current solicitation package, then edit and save it here.
              Editing and saving never calls AI.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={pending !== null || generationBlockers.length > 0}
            className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "generate" ? "Generating…" : sectionId ? "Regenerate bid" : "Generate bid"}
          </button>
        </div>

        {generationBlockers.length ? (
          <div role="alert" className="mt-4 rounded-xl border p-4 text-sm leading-6">
            <p className="font-semibold">Generation is blocked</p>
            <p className="mt-1">{generationBlockers[0]}</p>
          </div>
        ) : null}

        {sectionId ? (
          <div className="mt-5 grid gap-3">
            <label htmlFor="full-bid-content" className="text-sm font-semibold">Editable full bid</label>
            <textarea
              id="full-bid-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={24}
              className="min-h-[32rem] w-full rounded-xl border bg-white p-4 text-sm leading-6 outline-none focus:ring-2"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={pending !== null || !changed}
                className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {pending === "save" ? "Saving…" : "Save draft"}
              </button>
              <span className={needsInput ? "text-sm font-semibold" : "text-sm text-[var(--muted-foreground)]"}>
                {needsInput ? `${needsInput} Needs your input item(s) remain` : "No Needs your input placeholders detected"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed p-5 text-sm text-[var(--muted-foreground)]">
            No full bid has been generated yet. Use Generate bid when the source package is ready.
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Supporting documents</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
          Check only items you have prepared or will include with the submission. These are bidder-side
          supporting items, not buyer-document verification steps.
        </p>
        <div className="mt-4 grid gap-3">
          {supportingItems.length ? supportingItems.map((item) => (
            <label key={item.requirementId} className="flex items-start gap-3 rounded-xl border p-4">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed.includes(item.requirementId)}
                disabled={pending !== null}
                onChange={(event) => setConfirmed((current) =>
                  event.target.checked
                    ? [...new Set([...current, item.requirementId])]
                    : current.filter((id) => id !== item.requirementId))}
              />
              <span className="min-w-0">
                <span className="font-semibold">
                  {item.mandatory ? "Required" : "Conditional / review applicability"} · {item.kind.replaceAll("_", " ")}
                </span>
                <span className="mt-1 block break-words text-sm leading-6">{item.text}</span>
              </span>
            </label>
          )) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
              No separate supporting items were detected in the current solicitation.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={saveSupporting}
          disabled={pending !== null || !confirmationsChanged}
          className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending === "support" ? "Saving…" : "Save supporting checklist"}
        </button>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Review and package</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
          Approval applies only to the exact saved draft, current solicitation version, and supporting checklist.
          Any later change invalidates it.
        </p>
        <label className="mt-4 flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" className="mt-1" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
          I reviewed the complete saved bid, resolved all Needs your input fields, and confirmed required supporting items.
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={approve}
            disabled={pending !== null || !reviewed || !readyForHumanReview || approvalCurrent || changed || confirmationsChanged}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {pending === "approve" ? "Approving…" : approvalCurrent ? "Package approved" : "Approve current package"}
          </button>
          {approvalCurrent ? (
            <a
              href={`/api/bids/${workspaceId}/package`}
              className="rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              Download final package
            </a>
          ) : (
            <span className="rounded-lg border px-4 py-2 text-sm text-[var(--muted-foreground)]">
              Download unlocks after approval
            </span>
          )}
        </div>
        {!readyForHumanReview ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Resolve the remaining draft, source, submission, or required supporting-item blockers before approval.
          </p>
        ) : null}
        {message ? <p role="status" className="mt-4 text-sm">{message}</p> : null}
      </section>
    </div>
  );
}
