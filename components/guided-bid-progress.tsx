import Link from "next/link";

import type { BidWorkspaceRecord } from "@/lib/bids/workspace";
import { deriveBidGuidance } from "@/lib/bids/guided-progress";

export function GuidedBidProgress({ workspace }: { workspace: BidWorkspaceRecord }) {
  const guidance = deriveBidGuidance(workspace);
  const next = guidance.nextAction;
  const currentStep = guidance.steps.find((step) => step.id === next.stepId);

  return (
    <section aria-labelledby="bid-progress-title"
      className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Current step
          </p>
          <h2 id="bid-progress-title" className="mt-1 text-lg font-semibold">{next.label}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
            {next.reason}
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{next.owner}</span>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
        <Link href={next.href}
          className="inline-flex min-h-11 max-w-full items-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] [overflow-wrap:anywhere]">
          {currentStep?.title ?? "Continue bid"}
        </Link>
        <p className="text-xs text-[var(--muted-foreground)]">
          Finish this step before govTract asks you to work on the next one.
        </p>
      </div>

      <details className="mt-5 min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold">
          Workflow status and diagnostics
        </summary>
        <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
          Use this only when you need to inspect completed, future, or technical checks. These items
          do not replace the current step above.
        </p>
        <div className="mt-3 grid gap-2 text-xs">
          {guidance.steps.map((step) => (
            <div key={step.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[var(--muted)]/35 p-2">
              <span className="break-words font-medium">{step.title}</span>
              <span className="text-[var(--muted-foreground)]">
                {step.status}{step.count ? ` · ${step.count} to check` : ""}
              </span>
            </div>
          ))}
        </div>
        {guidance.groupedIssues.length ? (
          <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
            {guidance.groupedIssues.reduce((total, group) => total + group.issues.length, 0)}
            {" "}detailed final-review check(s) remain. Review them in Final review when they become actionable.
          </p>
        ) : null}
        <Link href={`/opportunities/${workspace.opportunityId}`}
          className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2">
          View opportunity and originals
        </Link>
      </details>

      <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">
        Manual AI drafting is optional and requires an explicit request. govTract never submits
        to the external procurement portal.
      </p>
    </section>
  );
}
