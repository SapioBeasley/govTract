"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { COMPLIANCE_STATUSES, isComplianceEvidence, isComplianceStatus, type ComplianceStatus } from "@/lib/bids/compliance";
import { explainComplianceRequirement, type ComplianceGuidanceContext } from "@/lib/bids/compliance-guidance";
import type { BidWorkspaceRequirement } from "@/lib/bids/workspace";
import { BidSourceReviewAction } from "@/components/bid-source-review-action";
import { nextRequirementAction } from "@/lib/bids/builder-actions";

const LABELS: Record<ComplianceStatus, string> = {
  missing: "Not addressed",
  drafting: "Working on it",
  complete: "Complete — addressed in my bid",
  needs_review: "Needs clarification or review",
  not_applicable: "Not applicable (verify against source)",
};

export function ComplianceRow({
  requirement,
  context,
}: {
  requirement: BidWorkspaceRequirement;
  context: ComplianceGuidanceContext;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(requirement.responseNotes ?? "");
  const [advancedStatus, setAdvancedStatus] = useState<ComplianceStatus>(
    isComplianceStatus(requirement.status) ? requirement.status : "needs_review",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Updates after source confirmation or saving should not retain a stale local dropdown.
  useEffect(() => {
    setNotes(requirement.responseNotes ?? "");
    setAdvancedStatus(isComplianceStatus(requirement.status) ? requirement.status : "needs_review");
  }, [requirement.status, requirement.responseNotes]);

  const evidence = isComplianceEvidence(requirement.evidence) ? requirement.evidence : null;
  const guidance = explainComplianceRequirement(requirement, context);
  const formConfirmed = evidence?.sourceRequirementId
    ? context.confirmedOriginalForms.includes(evidence.sourceRequirementId) : false;
  // The enclosing response heading supplies only its own linked current section.
  // The API independently validates its actual source key, content, and snapshot.
  const responseSection = requirement.requirementType === "form"
    ? null : context.sections.find((section) => section.ready) ?? null;
  const action = nextRequirementAction(requirement, {
    snapshotCurrent: context.snapshotCurrent,
    understandingCurrent: context.understandingCurrent,
    sourceReady: context.sourceReady,
    matchingResponseReady: Boolean(responseSection),
    originalFormConfirmed: formConfirmed,
  });
  const isForm = requirement.requirementType === "form";
  const canConfirm = action.kind === "confirm" &&
    (isForm ? formConfirmed : Boolean(responseSection));

  async function saveStatus(status: ComplianceStatus | null, reviewed = false) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/bids/" + context.workspaceId + "/compliance/" + requirement.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(status ? { status } : {}),
          responseNotes: notes.trim() || null,
          ...(reviewed ? {
            responseSelection: isForm
              ? { kind: "original_form" } : { kind: "section", sectionId: responseSection?.id },
            responseReviewed: true,
          } : {}),
        }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Your response could not be saved.");
      } else {
        setMessage(reviewed ? "Marked addressed in your saved bid." : "Progress and notes saved.");
        router.refresh();
      }
    } catch {
      setMessage("Could not save this requirement. Your entered notes remain available.");
    } finally {
      setPending(false);
    }
  }

  const pill = action.kind === "done" ? "Addressed" :
    action.kind === "source" ? "Check buyer instruction" :
    action.kind === "response" ? "Write response" :
    action.kind === "form" ? "Complete original form" : "Review your response";

  return (
    <article id={"compliance-requirement-" + requirement.id}
      className="min-w-0 scroll-mt-5 rounded-xl border p-4">
      <div className="flex min-w-0 flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full border px-2.5 py-1">{pill}</span>
        {evidence?.requirementLevel !== "unknown" ? (
          <span className="rounded-full bg-[var(--muted)] px-2.5 py-1">
            {evidence?.requirementLevel === "required" ? "Buyer requires" : "Buyer says optional"}
          </span>
        ) : null}
      </div>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        What the buyer wants
      </h4>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{requirement.text}</p>
      <div className="mt-3 min-w-0 rounded-lg bg-[var(--muted)]/35 p-3">
        <p className="text-sm font-semibold">What you need to do next</p>
        <p className="mt-1 text-sm font-medium">{action.title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{action.detail}</p>
        {action.kind === "source" ? (
          <>
            <p className="mt-2 text-xs leading-5">
              {context.snapshotCurrent && context.understandingCurrent
                ? "The source check is separate from writing your bid. Confirm the current original below."
                : "Your original documents or understanding need attention before this item can be confirmed."}
            </p>
            {!requirement.canMarkComplete && evidence &&
              (evidence.requirementLevel === "unknown" ||
                evidence.issues.some((issue) => ["requirement_requiredness_unknown",
                  "requirement_evidence_missing", "requirement_set_incomplete"].includes(issue))) ? (
                <BidSourceReviewAction requirement={requirement} context={context} />
              ) : (
                <Link href={guidance.link.href}
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
                  {guidance.link.label}
                </Link>
              )}
          </>
        ) : null}
        {action.kind === "response" ? (
          responseSection ? (
            <p className="mt-2 text-xs">Save the edited response above before confirming coverage.</p>
          ) : context.sections.length ? (
            <a href={"#response-section-" + context.sections[0]!.id}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
              Write and save the response above
            </a>
          ) : (
            <a href="#final-review"
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
              Check submission requirements and original forms
            </a>
          )
        ) : null}
        {action.kind === "form" ? (
          <a href="#final-review" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
            Complete and confirm the original form
          </a>
        ) : null}
        {action.kind === "confirm" && canConfirm ? (
          <details className="mt-3 min-w-0 rounded-lg border bg-white p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">Review saved response</summary>
            {responseSection ? (
              <>
                <p className="mt-2 text-xs font-semibold">{responseSection.title}</p>
                <blockquote className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 pl-3 text-xs leading-5">
                  {responseSection.content?.slice(0, 1800)}
                  {(responseSection.content?.length ?? 0) > 1800 ? "… (preview only; read the full response in the editor above)" : null}
                </blockquote>
                <a href={"#response-section-" + responseSection.id}
                  className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2">
                  Read or edit the full saved response
                </a>
              </>
            ) : (
              <p className="mt-2 text-xs">You have confirmed the completed original form in Final review.</p>
            )}
            <p className="mt-2 text-xs leading-5">
              Only confirm if your actual offer addresses this buyer request. Repeating the solicitation
              or an unverified AI draft is not proof that you can supply the item.
            </p>
            <button type="button" onClick={() => saveStatus("complete", true)} disabled={pending}
              className="mt-3 min-h-11 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
              {pending ? "Saving…" : "I reviewed this response — Mark addressed in my bid"}
            </button>
          </details>
        ) : null}
        {action.kind === "done" ? (
          <p className="mt-2 text-xs">Your saved response was explicitly reviewed. This does not submit a bid or verify vendor claims.</p>
        ) : null}
      </div>
      {message ? <p role="status" className="mt-3 break-words text-sm">{message}</p> : null}
      <details className="mt-3 min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-xs font-semibold">
          Original source and other options
        </summary>
        <div className="mt-3 grid min-w-0 gap-3 text-xs leading-5">
          <p><strong>Source verification:</strong> {requirement.canMarkComplete && context.snapshotCurrent &&
            context.understandingCurrent ? "Current original confirmed." : "Needs source review."}</p>
          <p><strong>Bid response:</strong> {requirement.effectiveStatus === "complete"
            ? "Reviewed and addressed in the current saved bid."
            : responseSection ? "Saved response is ready for your explicit review."
              : "No current linked saved response is ready."}</p>
          {evidence?.references.filter((reference) => reference.excerpt?.trim()).slice(0, 2).map((reference, index) => (
            <blockquote key={reference.opportunityDocumentVersionId + "-" + index}
              className="min-w-0 whitespace-pre-wrap break-words border-l-2 pl-3">
              <p className="mb-1 font-semibold">{reference.filename ?? "Original source"}</p>
              {reference.excerpt}
            </blockquote>
          ))}
          {evidence?.listingEvidence?.excerpt ? (
            <blockquote className="border-l-2 pl-3">{evidence.listingEvidence.excerpt}</blockquote>
          ) : null}
          <Link href={"/bids/" + context.workspaceId + "/evidence/" + requirement.id}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
            View full source history (read-only)
          </Link>
          {guidance.kind === "blocked" ? (
            <p>{guidance.explanation} {guidance.nextAction}</p>
          ) : null}
          <label className="grid gap-1 font-semibold">
            Progress status (optional)
            <select value={advancedStatus} onChange={(event) => setAdvancedStatus(event.target.value as ComplianceStatus)}
              className="min-h-11 w-full rounded-lg border bg-white p-2 text-sm">
              {COMPLIANCE_STATUSES.map((value) => (
                <option key={value} value={value} disabled={value === "complete"}>
                  {value === "complete" ? "Addressed — use Review saved response above" : LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-semibold">
            Private response notes (optional)
            <textarea value={notes} rows={2} maxLength={10000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What remains to do? Which part of your offer addresses this?"
              className="min-w-0 rounded-lg border bg-white p-2 text-sm font-normal" />
          </label>
          <button type="button"
            onClick={() => saveStatus(advancedStatus === "complete" ? null : advancedStatus)}
            disabled={pending || (advancedStatus === requirement.status && notes === (requirement.responseNotes ?? ""))}
            className="min-h-11 w-fit rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save progress and notes"}
          </button>
        </div>
      </details>
    </article>
  );
}

type Filter = "all" | "actionable" | "blocked" | "addressed";

export function ComplianceMatrixControl({
  workspaceId,
  requirements,
  sourceAvailable,
  context,
}: {
  workspaceId: string;
  requirements: BidWorkspaceRequirement[];
  sourceAvailable: boolean;
  context: ComplianceGuidanceContext;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/compliance`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Checklist could not be updated.");
      else {
        setMessage("Checklist refreshed from saved source evidence; prior responses were preserved.");
        router.refresh();
      }
    } catch {
      setMessage("Checklist could not be updated. Saved responses were not overwritten.");
    } finally {
      setPending(false);
    }
  }

  const rows = requirements.map((requirement) => ({
    requirement, guidance: explainComplianceRequirement(requirement, context),
  }));
  const counts = {
    all: rows.length,
    actionable: rows.filter(({ guidance }) => guidance.kind === "actionable").length,
    blocked: rows.filter(({ guidance }) => guidance.kind === "blocked").length,
    addressed: rows.filter(({ guidance }) => guidance.kind === "addressed").length,
  };
  const visible = filter === "all" ? rows : rows.filter(({ guidance }) => guidance.kind === filter);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="min-w-0 rounded-xl border bg-[var(--muted)]/35 p-4 text-sm leading-6">
        <h3 className="font-semibold">How to use this checklist</h3>
        <p className="mt-1">
          Each card is a requirement from the buyer's solicitation. Review the original source,
          prepare the matching bid response or form, and record where you addressed it.
          Choose <strong>Complete</strong> only after your saved bid response or confirmed original form actually addresses that verified requirement.
        </p>
        <p className="mt-2">
          If Complete is disabled, read the reason and use its link to prepare your response, confirm an original form, or repair the source.
          You can still save work-in-progress notes. Checking off a requirement does not verify
          vendor claims, original signatures, or final portal submission.
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{requirements.length} buyer requirement{requirements.length === 1 ? "" : "s"}</p>
        <button type="button" onClick={generate} disabled={pending || !sourceAvailable}
          className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Updating…" : requirements.length ? "Add newly extracted requirements" : "Build requirement checklist"}
        </button>
      </div>
      {message ? <p role="status" className="min-w-0 break-words text-sm">{message}</p> : null}
      {requirements.length ? (
        <>
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Filter bid requirements">
            {([
              ["all", "All"],
              ["actionable", "My next responses"],
              ["blocked", "Blocked — see next action"],
              ["addressed", "Addressed"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${filter === value ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-white"}`}>
                {label} ({counts[value]})
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            A disabled Complete may mean missing original evidence or an unfinished bid response. Follow the specific next action shown on each card.
          </p>
          <div className="grid min-w-0 gap-3">
            {visible.map(({ requirement }) => (
              <ComplianceRow key={requirement.id} requirement={requirement} context={context} />
            ))}
            {!visible.length ? <p className="rounded-lg border border-dashed p-4 text-sm">No requirements in this view. Choose All to see every saved item.</p> : null}
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
          {sourceAvailable ? "Build a requirement checklist from the saved solicitation evidence. This does not call AI."
            : "No structured requirements are available. Finish solicitation understanding before building this checklist."}
        </p>
      )}
    </div>
  );
}
