"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { BidSubmissionRecord } from "@/lib/bids/submission";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

type Props = {
  workspaceId: string;
  opportunityId: string;
  review: BidWorkspaceRecord["finalReview"];
  confirmedOriginalForms: string[];
  approvalCurrent: boolean;
  submissions: BidSubmissionRecord[];
  currentSubmission: BidSubmissionRecord | null;
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
      )) : check.listingEvidence ? (
        <p className="break-words">Authoritative opportunity listing · {check.listingEvidence.field}
          {" · Source record "}{check.listingEvidence.sourceRecordId}
          {" · Payload SHA-256 "}{check.listingEvidence.payloadHash}
          {" · "}{check.listingEvidence.excerpt}
        </p>
      ) : <p>Authoritative source evidence is missing; do not rely on this requirement as verified.</p>}
      {check.sourceTemplateRequired ? (
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

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function submissionDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/Chicago", timeZoneName: "short",
  }).format(new Date(value));
}

export function BidFinalReview({
  workspaceId,
  opportunityId,
  review,
  confirmedOriginalForms,
  approvalCurrent,
  submissions,
  currentSubmission,
}: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState<string[]>(confirmedOriginalForms);
  useEffect(() => setConfirmed(confirmedOriginalForms), [confirmedOriginalForms]);
  const [humanReviewed, setHumanReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [submittedAt, setSubmittedAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [submissionNotes, setSubmissionNotes] = useState("");

  useEffect(() => {
    if (approvalCurrent && !currentSubmission && !submittedAt) {
      setSubmittedAt(localDateTimeValue());
    }
  }, [approvalCurrent, currentSubmission, submittedAt]);

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

  async function confirmSubmission() {
    if (!submissionConfirmed) return;
    const submitted = new Date(submittedAt);
    if (!submittedAt || Number.isNaN(submitted.getTime())) {
      setSubmissionMessage("Enter a valid submission date and time.");
      return;
    }
    setSubmissionPending(true);
    setSubmissionMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submittedAt: submitted.toISOString(),
          confirmationNumber: confirmationNumber.trim() || null,
          receiptUrl: receiptUrl.trim() || null,
          notes: submissionNotes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setSubmissionMessage(payload?.error?.message ?? "External submission could not be recorded.");
      } else {
        setSubmissionMessage("External submission recorded for this exact approved package.");
        router.refresh();
      }
    } catch {
      setSubmissionMessage("External submission could not be recorded.");
    } finally {
      setSubmissionPending(false);
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
          {approvalCurrent && review.readyForHumanReview
            ? "Human review recorded — approved package can be downloaded"
            : review.readyForHumanReview
              ? "Checklist has no package blockers — human approval required"
              : `${review.blockingIssues.length} outstanding package check(s) — not ready for approval`}
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
        {review.warnings.length ? (
          <div className="mt-4 rounded-lg bg-[var(--muted)]/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Review before external submission
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--muted-foreground)]">
              {review.warnings.map((warning, index) => (
                <li key={`${warning.code}-${warning.requirementId ?? warning.sectionId ?? warning.documentId ?? index}`}
                  className="break-words [overflow-wrap:anywhere]">{warning.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3">
        <h3 className="font-semibold">Supporting documents</h3>
        {review.sourceChecks.length ? review.sourceChecks.map((check) => (
          <article key={check.requirementId} id={`original-form-${check.requirementId}`} className="min-w-0 scroll-mt-5 rounded-xl border p-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border px-2 py-1 capitalize">{check.kind.replaceAll("_", " ")}</span>
              <span className="rounded-full border px-2 py-1">
                {check.conditional ? "Conditional" : check.mandatory ? "Mandatory" : "Review requiredness"}
              </span>
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
                I have completed this required supporting item and included it in my submission package.
                This confirmation does not establish that the external portal received it.
              </label>
            ) : null}
          </article>
        )) : <p>No submission/form requirements have been verified. Review source instructions.</p>}
        {originals.length ? (
          <button type="button" disabled={pending || !changed}
            onClick={() => patch({ confirmedOriginalForms: confirmed })}
            className="w-fit rounded-lg border px-3 py-2 font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save supporting-document checklist"}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">Final approval & download</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Review the exact current package, then record explicit human approval. Approval is fingerprint-bound and becomes stale if the bid, supporting checklist, or source package changes.
        </p>
        <div className="mt-4 rounded-lg border p-3">
          <h4 className="font-semibold">Package manifest</h4>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            The downloadable package contains the exact saved full bid plus a deterministic manifest of supporting items confirmed in govTract.
            Items that still must be completed or uploaded in the authoritative procurement system remain listed.
          </p>
          <a href={`/api/bids/${workspaceId}/package`}
            className="mt-3 inline-flex rounded-lg border px-3 py-2 font-semibold">
            Download package manifest
          </a>
          {!approvalCurrent || !review.readyForHumanReview ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              This download is for review and preparation until the exact package is approved.
            </p>
          ) : null}
        </div>
        <label className="mt-4 flex items-start gap-2 leading-6">
          <input type="checkbox" className="mt-1.5" checked={humanReviewed}
            onChange={(event) => setHumanReviewed(event.target.checked)} />
          I have personally reviewed the current original solicitation package, all amendments,
          final response, required attachments, signatures, deadline, and authoritative submission method.
        </label>
        <button type="button"
          disabled={pending || changed || !humanReviewed || !review.readyForHumanReview || approvalCurrent}
          onClick={() => patch({ reviewState: "approved", humanReviewConfirmed: true })}
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-2 font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {pending ? "Recording review…" : approvalCurrent ? "Human review current" : "Approve current package"}
        </button>
        {message ? <p role="status" className="mt-3 break-words text-xs">{message}</p> : null}
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          govTract does not submit a bid on your behalf. Any subsequent package or source change invalidates
          the current approval and does not transfer Submitted status to the revised package.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">Authoritative submission handoff</h3>
        {currentSubmission ? (
          <div role="status" className="mt-3 rounded-lg border bg-[var(--muted)]/35 p-3">
            <p className="font-semibold">Submitted — external submission confirmed by you</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Recorded {submissionDate(currentSubmission.submittedAt)} for this exact approved package.
              govTract did not perform or independently verify the portal submission.
            </p>
            {currentSubmission.confirmationNumber ? (
              <p className="mt-2 text-sm">Confirmation/reference: {currentSubmission.confirmationNumber}</p>
            ) : null}
            {currentSubmission.receiptUrl ? (
              <a href={currentSubmission.receiptUrl} target="_blank" rel="noreferrer"
                className="mt-2 inline-block break-words text-sm font-semibold underline underline-offset-2 [overflow-wrap:anywhere]">
                Open recorded receipt / confirmation evidence
              </a>
            ) : null}
            {currentSubmission.notes ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{currentSubmission.notes}</p>
            ) : null}
          </div>
        ) : approvalCurrent ? (
          <p className="mt-3 font-semibold">Next action: Submit externally in the authoritative procurement portal.</p>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Approve the exact current package before recording an external submission.
          </p>
        )}
        <p className="mt-2 break-words [overflow-wrap:anywhere]">Method: {review.submission.method}</p>
        <p className="mt-1">Due: {review.submission.dueAt
          ? new Intl.DateTimeFormat("en-US", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit",
              timeZone: "America/Chicago", timeZoneName: "short",
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
          Opening the portal does not submit the bid. Follow its requirements and retain its submission receipt.
        </p>

        {approvalCurrent && !currentSubmission ? (
          <div className="mt-4 grid gap-3 border-t pt-4">
            <h4 className="font-semibold">Confirm submission</h4>
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              Record what happened in the external portal. govTract stores your confirmation and optional evidence;
              it does not submit on your behalf or independently verify that the portal accepted the bid.
            </p>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Submission date/time</span>
              <input type="datetime-local" value={submittedAt}
                onChange={(event) => setSubmittedAt(event.target.value)}
                className="h-10 rounded-lg border bg-white px-3" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Confirmation/reference number (optional)</span>
              <input value={confirmationNumber}
                onChange={(event) => setConfirmationNumber(event.target.value)}
                maxLength={500}
                className="h-10 rounded-lg border bg-white px-3"
                placeholder="Portal confirmation or reference number" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Receipt/confirmation link (optional)</span>
              <input type="url" value={receiptUrl}
                onChange={(event) => setReceiptUrl(event.target.value)}
                maxLength={2000}
                className="h-10 rounded-lg border bg-white px-3"
                placeholder="https://…" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Submission notes (optional)</span>
              <textarea value={submissionNotes}
                onChange={(event) => setSubmissionNotes(event.target.value)}
                rows={3}
                maxLength={10000}
                className="rounded-lg border bg-white px-3 py-2"
                placeholder="Anything useful about the external submission or receipt." />
            </label>
            <label className="flex items-start gap-2 text-sm leading-6">
              <input type="checkbox" className="mt-1.5" checked={submissionConfirmed}
                onChange={(event) => setSubmissionConfirmed(event.target.checked)} />
              I confirm that I submitted this exact approved package through the authoritative external channel.
            </label>
            <button type="button"
              disabled={submissionPending || !submissionConfirmed || !submittedAt}
              onClick={confirmSubmission}
              className="w-fit rounded-lg bg-[var(--primary)] px-3 py-2 font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
              {submissionPending ? "Recording submission…" : "Confirm submission"}
            </button>
            {submissionMessage ? <p role="status" className="text-xs">{submissionMessage}</p> : null}
          </div>
        ) : null}

        {submissions.filter((submission) => submission.id !== currentSubmission?.id).length ? (
          <details className="mt-4 border-t pt-4">
            <summary className="cursor-pointer font-medium">Previous submission records</summary>
            <div className="mt-3 grid gap-2 text-sm">
              {submissions.filter((submission) => submission.id !== currentSubmission?.id).map((submission) => (
                <div key={submission.id} className="rounded-lg bg-[var(--muted)]/35 p-3">
                  <p className="font-medium">{submissionDate(submission.submittedAt)}</p>
                  <p className="mt-1 break-all text-xs text-[var(--muted-foreground)]">
                    Package fingerprint: {submission.reviewFingerprint}
                  </p>
                  {submission.confirmationNumber ? <p className="mt-1">Reference: {submission.confirmationNumber}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
