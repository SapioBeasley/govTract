"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BID_RESPONSE_SOURCE_TYPES,
  type BidRequirementQuestion,
  type BidResponseSourceType,
} from "@/lib/bids/requirement-question-rules";
import type { BidWorkspaceSection } from "@/lib/bids/workspace";

const SOURCE_LABELS: Record<BidResponseSourceType, string> = {
  self: "My company",
  subcontractor: "Subcontractor",
  manufacturer: "Manufacturer",
  other: "Other third party",
};

function RequirementQuestionCard({
  workspaceId,
  item,
}: {
  workspaceId: string;
  item: BidRequirementQuestion;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState(item.responseNotes ?? "");
  const [sourceType, setSourceType] = useState<BidResponseSourceType>(
    item.responseSourceType ?? "self",
  );
  const [sourceName, setSourceName] = useState(item.responseSourceName ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setAnswer(item.responseNotes ?? "");
    setSourceType(item.responseSourceType ?? "self");
    setSourceName(item.responseSourceName ?? "");
  }, [item.id, item.responseNotes, item.responseSourceType, item.responseSourceName]);

  const changed =
    answer !== (item.responseNotes ?? "") ||
    sourceType !== (item.responseSourceType ?? "self") ||
    sourceName !== (item.responseSourceName ?? "");

  async function save() {
    if (pending || !changed) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/bids/${workspaceId}/requirements/${item.id}/response`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            responseNotes: answer.trim() || null,
            responseSourceType: sourceType,
            responseSourceName: sourceName.trim() || null,
          }),
        },
      );
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Response could not be saved.");
      } else {
        setMessage(answer.trim() ? "Response saved." : "Question assignment saved.");
        router.refresh();
      }
    } catch {
      setMessage("Response could not be saved. Your text is still on this screen.");
    } finally {
      setPending(false);
    }
  }

  async function copyQuestion() {
    const text = [
      "Buyer requirement:",
      item.text,
      "",
      "Response needed:",
      item.question,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Question copied.");
    } catch {
      setMessage("Copy failed. Select the question text manually.");
    }
  }

  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--muted-foreground)]">
        <span className="rounded-full border px-2 py-1">
          {item.isRequired ? "Required" : "Optional / verify applicability"}
        </span>
        {item.responseNotes?.trim() ? (
          <span className="rounded-full border px-2 py-1">Response saved</span>
        ) : (
          <span className="rounded-full border px-2 py-1">Waiting for response</span>
        )}
      </div>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Buyer requirement
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.text}</p>

      <p className="mt-3 text-sm font-semibold">{item.question}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium">
          Who should answer this?
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as BidResponseSourceType)}
            className="min-h-11 rounded-lg border bg-white px-3 text-sm"
          >
            {BID_RESPONSE_SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>{SOURCE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Company / contact name (optional)
          <input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder={sourceType === "self" ? "Your company" : "Supplier or partner name"}
            className="min-h-11 rounded-lg border bg-white px-3 text-sm"
          />
        </label>
      </div>

      <label className="mt-3 grid gap-1.5 text-xs font-medium">
        Response
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={4}
          placeholder="Enter the factual response you want the bid draft to use."
          className="w-full rounded-lg border bg-white p-3 text-sm leading-6"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !changed}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save response"}
        </button>
        <button
          type="button"
          onClick={copyQuestion}
          className="rounded-lg border px-3 py-2 text-sm font-semibold"
        >
          Copy question
        </button>
        {message ? <span role="status" className="text-xs text-[var(--muted-foreground)]">{message}</span> : null}
      </div>
    </article>
  );
}

export function BidPackageControl({
  workspaceId,
  initialSections,
  initialQuestions,
  questionSourceReady,
  sourceReady,
  sourceBlockers,
  requiresUnderstandingRefresh,
}: {
  workspaceId: string;
  initialSections: BidWorkspaceSection[];
  initialQuestions: BidRequirementQuestion[];
  questionSourceReady: boolean;
  sourceReady: boolean;
  sourceBlockers: string[];
  requiresUnderstandingRefresh: boolean;
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

  useEffect(() => {
    setContent(fullBid?.content ?? "");
    setSavedContent(fullBid?.content ?? "");
  }, [fullBid?.id, fullBid?.content]);

  const changed = content !== savedContent;
  const answeredCount = initialQuestions.filter((question) => Boolean(question.responseNotes?.trim())).length;
  const requiredQuestions = initialQuestions.filter((question) => question.isRequired);
  const requiredAnswered = requiredQuestions.filter((question) => Boolean(question.responseNotes?.trim())).length;
  const unansweredRequired = requiredQuestions.length - requiredAnswered;
  const questionsGenerated = initialQuestions.length > 0;

  async function generateQuestions() {
    if (!questionSourceReady || pending || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/questions`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Requirement questions could not be generated.");
      } else {
        setMessage("Requirement questions are ready. Save responses as you receive them.");
        router.refresh();
      }
    } catch {
      setMessage("Requirement questions could not be generated.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function draftBid() {
    if (!sourceReady || pending || inFlight.current || changed || unansweredRequired > 0) return;
    const replace = Boolean(fullBid?.content?.trim());
    const understandingNote = requiresUnderstandingRefresh
      ? " The retained solicitation understanding will be refreshed first if required; that may add model cost."
      : "";
    const confirmation = replace
      ? "Draft the bid again? This explicit AI action may incur model cost and will replace only the saved bid draft. Your saved requirement responses will be preserved."
      : "Draft the bid using the saved requirement responses? This is an explicit AI action that may incur model cost.";
    if (!window.confirm(confirmation + understandingNote)) return;

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
        generation?: { applied?: boolean; content?: string };
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Bid drafting failed.");
      } else if (!payload.generation?.applied) {
        setMessage("The solicitation or bid changed during drafting. Your saved responses and prior bid were preserved.");
      } else if (typeof payload.generation.content === "string") {
        setContent(payload.generation.content);
        setSavedContent(payload.generation.content);
        setMessage("Bid drafted. Review and edit the saved response before final package approval.");
        router.refresh();
      }
    } catch {
      setMessage("Bid drafting failed. Your saved requirement responses were preserved.");
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
        setMessage("Bid saved.");
        router.refresh();
      }
    } catch {
      setMessage("Bid changes could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const steps = [
    ["1", "Start bid", "Started"],
    ["2", "Requirement questions", questionsGenerated ? `${initialQuestions.length} ready` : "Not generated"],
    ["3", "Populate responses", questionsGenerated ? `${answeredCount} of ${initialQuestions.length} saved` : "Waiting"],
    ["4", "Draft bid", fullBid?.content?.trim() ? "Draft ready" : "Not drafted"],
    ["5", "Approve / download", "Final review below"],
  ];

  return (
    <div className="grid gap-5">
      <div className="grid gap-2 sm:grid-cols-5">
        {steps.map(([number, label, status]) => (
          <div key={number} className="rounded-xl border bg-[var(--muted)]/25 p-3">
            <div className="text-xs font-semibold text-[var(--muted-foreground)]">Step {number}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">{status}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">Generate requirement questions</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Create the fact questions needed to prepare the bid before drafting. Question generation is deterministic and does not call AI.
              Responses can come from your company, a subcontractor, a manufacturer, or another third party.
            </p>
          </div>
          <button
            type="button"
            onClick={generateQuestions}
            disabled={!questionSourceReady || pending}
            className="shrink-0 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {pending ? "Working…" : questionsGenerated ? "Refresh questions" : "Generate questions"}
          </button>
        </div>
        {!questionSourceReady ? (
          <p role="status" className="mt-3 text-sm text-[var(--muted-foreground)]">
            {sourceBlockers[0] ??
              "The current solicitation understanding is not ready for requirement questions. Review or refresh the current source understanding below first."}
          </p>
        ) : null}
      </section>

      {questionsGenerated ? (
        <section className="rounded-xl border p-4">
          <h3 className="font-semibold">Populate responses</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
            Save each factual response as you receive it. These responses are stored separately from the draft,
            so drafting again will not erase them.
          </p>
          <div className="mt-4 grid gap-3">
            {initialQuestions.map((item) => (
              <RequirementQuestionCard key={item.id} workspaceId={workspaceId} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">Draft bid</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              AI drafts one editable response from the retained solicitation evidence plus your saved bidder/supplier responses.
              Saved responses remain separate and are never cleared when the draft is replaced.
            </p>
            {unansweredRequired > 0 ? (
              <p className="mt-2 text-xs font-medium">
                Save {unansweredRequired} required response{unansweredRequired === 1 ? "" : "s"} before drafting.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={draftBid}
            disabled={!sourceReady || pending || changed || !questionsGenerated || unansweredRequired > 0}
            className="shrink-0 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {pending ? "Working…" : fullBid?.content?.trim() ? "Draft bid again" : "Draft bid"}
          </button>
        </div>
        {!sourceReady ? (
          <p role="status" className="mt-3 text-sm text-[var(--muted-foreground)]">
            {sourceBlockers[0] ?? "The retained solicitation package is not ready for drafting yet."}
          </p>
        ) : changed ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">Save your current bid edits before drafting again.</p>
        ) : null}
      </section>

      {fullBid ? (
        <section className="rounded-xl border p-4">
          <label htmlFor="full-bid-response" className="font-semibold">Full bid response</label>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            Review and edit this draft directly. Ordinary editing and saving never invoke AI.
          </p>
          <textarea
            id="full-bid-response"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="mt-3 min-h-[36rem] w-full rounded-lg border bg-white p-3 text-sm leading-6"
            spellCheck
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!changed || pending}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save bid"}
            </button>
            {/\[NEEDS INPUT:/i.test(content) ? (
              <span className="text-xs font-medium">
                The draft still contains unresolved facts. Add the missing response above and draft again, or edit the bid manually.
              </span>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
          Complete the requirement responses above, then draft the bid.
        </div>
      )}

      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
