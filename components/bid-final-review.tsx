"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

type Props = {
  workspaceId: string;
  opportunityId: string;
  review: BidWorkspaceRecord["finalReview"];
  confirmedOriginalForms: string[];
  approvalCurrent: boolean;
};

function Evidence({ check, workspaceId }: {
  check: BidWorkspaceRecord["finalReview"]["sourceChecks"][number];
  workspaceId: string;
}) {
  return (
    <div className="mt-2 space-y-2 text-xs text-[var(--muted-foreground)]">
      {check.references.length ? check.references.map((reference, index) => (
        <div key={`${reference.opportunityDocumentVersionId}-${index}`} className="min-w-0 break-words [overflow-wrap:anywhere]">
          Evidence: {reference.filename ?? "Unmatched file"} · Version {reference.opportunityDocumentVersionId}
          {" · SHA-256 "}{reference.checksumSha256 ?? "Unverified"}
          {typeof reference.locator.page === "number" ? ` · Page ${reference.locator.page}` : ""}
        </div>
      )) : <p>Authoritative source evidence is missing; do not rely on this requirement as verified.</p>}
      {check.originalRequired ? (
        check.originalDocuments.length ? (
          <div className="grid min-w-0 gap-1">
            {check.originalDocuments.map((document) => (
              <div key={document.id} className="min-w-0 break-words [overflow-wrap:anywhere]">
                Original template: {document.filename} · Version {document.opportunityDocumentVersionId}
                {" · SHA-256 "}{document.checksumSha256 ?? "Unverified"}
                {document.status === "stored" ? (
                  <> · <a className="font-semibold underline underline-offset-2"
                    href={`/api/bids/${workspaceId}/source-files/${document.id}`}>
                    Download original source file
                  </a></>
                ) : <> · {document.status} — not available for download</>}
              </div>
            ))}
          </div>
        ) : <p>Original source template was not matched to the retained source package. Find and verify it at the authoritative portal.</p>
      ) : null}
    </div>
  );
}

export function BidFinalReview({ workspaceId, opportunityId, review, confirmedOriginalForms, approvalCurrent }: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<string[]>(confirmedOriginalForms);
  const [humanReviewed, setHumanReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const changed = [...confirmed].sort().join("|") !== [...confirmedOriginalForms].sort().join("|");
  const originals = review.sourceChecks.filter((check) => check.originalRequired);

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Final review could not be saved.");
      } else {
        setMessage("Saved. Recheck the current source package and checklist.");
        router.refresh();
      }
    } catch {
      setMessage("Final review could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5 text-sm">
      <p className="leading-6 text-[var(--muted-foreground)]">
        This is a preparation checklist, not legal or procurement-compliance certification.
        Confirm the complete current solicitation package, original required forms, signatures,
        files, portal steps, and deadline yourself. Only the authoritative submission channel can
        confirm that your bid was actually received.
      </p>
      <div role="status" className="rounded-xl border p-4">
        <p className="font-semibold">
          {review.readyForExternalSubmission
            ? "Human review recorded — package may be handed off for external submission"
            : review.readyForHumanReview
              ? "Checklist has no detected blockers — human approval required"
              : `${review.blockingIssues.length} outstanding final-review check(s) — not ready for external submission`}
        </p>
        {!approvalCurrent && !review.readyForHumanReview ? (
          <p className="mt-2 text-xs">A previous approval, if any, is not valid for this current package.</p>
        ) : null}
        {review.blockingIssues.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {review.blockingIssues.map((issue, index) => (
              <li key={`${issue.code}-${issue.requirementId ?? issue.sectionId ?? issue.documentId ?? index}`}
                className="break-words [overflow-wrap:anywhere]">{issue.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">Authoritative submission handoff</h3>
        <p className="mt-2 break-words [overflow-wrap:anywhere]">Method: {review.submission.method}</p>
        <p className="mt-1">Due: {review.submission.dueAt
          ? new Intl.DateTimeFormat("en-US", {
              dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago", timeZoneName: "short",
            }).format(new Date(review.submission.dueAt))
          : "Not verified — check source instructions"}</p>
        <p className="mt-1">Submission file types, naming, format, and portal steps must be confirmed from the cited original solicitation.</p>
        {review.submission.instructions.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {review.submission.instructions.map((instruction, index) => (
              <li key={index} className="break-words [overflow-wrap:anywhere]">{instruction}</li>
            ))}
          </ul>
        ) : <p className="mt-2">No verified source submission instructions have been captured.</p>}
        {review.submission.portalUrl ? (
          <a href={review.submission.portalUrl} target="_blank" rel="noreferrer"
            className="mt-3 inline-flex max-w-full break-words rounded-lg border px-3 py-2 font-semibold underline underline-offset-2 [overflow-wrap:anywhere]">
            Open authoritative opportunity / external submission channel
          </a>
        ) : (
          <Link href={`/opportunities/${opportunityId}`} className="mt-2 inline-block underline underline-offset-2">
            Return to opportunity to verify the external channel
          </Link>
        )}
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Opening the portal does not submit the bid. Follow its requirements and retain its submission receipt separately.
        </p>
      </div>

      <div className="grid min-w-0 gap-3">
        <h3 className="font-semibold">Cited forms, attachments, signatures, and submission instructions</h3>
        {review.sourceChecks.length ? review.sourceChecks.map((check) => (
          <article key={check.requirementId} className="min-w-0 rounded-xl border p-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border px-2 py-1 capitalize">{check.kind.replaceAll("_", " ")}</span>
              <span className="rounded-full border px-2 py-1">{check.mandatory ? "Mandatory" : "Review requiredness"}</span>
              <span className="rounded-full border px-2 py-1">Response: {check.responseStatus.replaceAll("_", " ")}</span>
            </div>
            <p className="mt-2 break-words [overflow-wrap:anywhere]">{check.text}</p>
            <Evidence check={check} workspaceId={workspaceId} />
            {check.originalRequired ? (
              <label className="mt-3 flex min-w-0 items-start gap-2 leading-6">
                <input type="checkbox" className="mt-1.5" disabled={pending}
                  checked={confirmed.includes(check.requirementId)}
                  onChange={(event) => setConfirmed((current) =>
                    event.target.checked
                      ? [...new Set([...current, check.requirementId])]
                      : current.filter((id) => id !== check.requirementId))} />
                I have inspected and completed the original source form/template and included it for external submission.
                This confirmation does not establish that the external portal received it.
              </label>
            ) : null}
          </article>
        )) : <p>No submission/form requirements have been verified. Review source instructions.</p>}
        {originals.length ? (
          <button type="button" disabled={pending || !changed}
            onClick={() => patch({ confirmedOriginalForms: confirmed })}
            className="w-fit rounded-lg border px-3 py-2 font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save original-form confirmations"}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border p-4">
        <label className="flex items-start gap-2 leading-6">
          <input type="checkbox" className="mt-1.5" checked={humanReviewed}
            onChange={(event) => setHumanReviewed(event.target.checked)} />
          I have personally reviewed the current original solicitation package, all amendments,
          final response, required attachments, signatures, deadline, and authoritative submission method.
        </label>
        <button type="button"
          disabled={pending || changed || !humanReviewed || !review.readyForHumanReview || approvalCurrent}
          onClick={() => patch({ reviewState: "approved", humanReviewConfirmed: true })}
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-2 font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {pending ? "Recording review…" : approvalCurrent ? "Human review current" : "Approve current package for external handoff"}
        </button>
        {message ? <p role="status" className="mt-3 break-words text-xs">{message}</p> : null}
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          govTract does not submit a bid or mark it Submitted. Complete the submission at the authoritative portal
          and verify its receipt there. Any subsequent package or source change invalidates this approval.
        </p>
      </div>
    </div>
  );
}
