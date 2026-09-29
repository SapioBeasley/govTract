"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PackageStatus = {
  readyForApproval: boolean;
  blockers: Array<{ code: string; message: string; itemId?: string }>;
  packageFingerprint: string;
  approvalCurrent: boolean;
  approvedAt: string | null;
  submission: { url: string | null; instructions: string[] };
};

export function BidPackageControl({
  workspaceId,
  initialStatus,
}: {
  workspaceId: string;
  initialStatus: PackageStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handoffUrl = status.submission.url && /^https:\/\//i.test(status.submission.url)
    ? status.submission.url
    : null;

  async function approve() {
    if (pending || !status.readyForApproval || status.approvalCurrent) return;
    if (!window.confirm(
      "Approve the exact saved bid response and current supporting-material status for packaging? Any later edit or source/support change will require approval again.",
    )) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/package`, { method: "POST" });
      const body = await response.json() as {
        packageStatus?: PackageStatus;
        error?: { message?: string };
      };
      if (!response.ok || !body.packageStatus) {
        setMessage(body.error?.message ?? "Package approval could not be saved.");
      } else {
        setStatus(body.packageStatus);
        setMessage("Exact saved bid approved for packaging.");
        router.refresh();
      }
    } catch {
      setMessage("Package approval could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">Final package</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
            Approve the exact saved response only after all response placeholders and required supporting materials are resolved.
          </p>
        </div>
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium">
          {status.approvalCurrent ? "Approved" : status.readyForApproval ? "Ready for approval" : "Not ready"}
        </span>
      </div>

      {status.blockers.length ? (
        <div className="grid gap-2 rounded-xl border p-4">
          <p className="text-sm font-semibold">Finish these before approval</p>
          {status.blockers.map((blocker, index) => (
            <p key={`${blocker.code}-${blocker.itemId ?? index}`} className="text-sm leading-6 text-[var(--muted-foreground)]">
              {blocker.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={pending || !status.readyForApproval || status.approvalCurrent}
          className="min-h-11 rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Approving…" : status.approvalCurrent ? "Exact saved bid approved" : "Approve exact saved bid"}
        </button>
        {status.approvalCurrent ? (
          <a
            href={`/api/bids/${workspaceId}/package/download`}
            className="inline-flex min-h-11 items-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Download package
          </a>
        ) : (
          <span className="inline-flex min-h-11 items-center rounded-lg bg-[var(--muted)] px-4 py-2 text-sm font-semibold text-[var(--muted-foreground)] opacity-70">
            Download package
          </span>
        )}
      </div>

      <div className="rounded-xl bg-[var(--muted)]/35 p-4 text-sm leading-6">
        <p>
          The download contains the exact saved <strong>bid-response.md</strong> plus <strong>manifest.json</strong> with source/version metadata and the supporting-item handoff list.
        </p>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Supporting attachments remain external because govTract does not store those bidder files in this workflow.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <p className="text-sm font-semibold">Submission handoff</p>
        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
          govTract has not submitted this bid. Download the approved package, add the supporting files listed in the manifest, and complete submission in the authoritative buyer system.
        </p>
        {status.submission.instructions.length ? (
          <div className="mt-3 grid gap-1 text-sm">
            {status.submission.instructions.map((instruction, index) => (
              <p key={index}>{instruction}</p>
            ))}
          </div>
        ) : null}
        {handoffUrl ? (
          <a
            href={handoffUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
          >
            Open external procurement system
          </a>
        ) : (
          <p className="mt-3 text-sm font-medium">Open external procurement system from the solicitation source link above.</p>
        )}
      </div>

      {status.approvedAt ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Approved package version: {status.packageFingerprint.slice(0, 12)} · {new Date(status.approvedAt).toLocaleString()}
        </p>
      ) : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
