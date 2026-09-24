import Link from "next/link";

import type { BidWorkspaceRecord } from "@/lib/bids/workspace";
import { deriveBidGuidance } from "@/lib/bids/guided-progress";

export function GuidedBidProgress({ workspace }: { workspace: BidWorkspaceRecord }) {
  const guidance = deriveBidGuidance(workspace);
  const next = guidance.nextAction;

  return (
    <section aria-labelledby="bid-progress-title"
      className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="bid-progress-title" className="text-lg font-semibold">Your bid: guided progress</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Progress reflects saved source evidence and final-review checks, not a separate checklist.
            Steps may be completed in parallel; open any section for expert controls.
          </p>
        </div>
        <Link href={`/opportunities/${workspace.opportunityId}`}
          className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-semibold underline underline-offset-2">
          View opportunity and originals
        </Link>
      </div>

      <div className="mt-4 min-w-0 rounded-xl border bg-[var(--muted)]/40 p-4" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide">Next actionable task · {next.owner}</p>
        <h3 className="mt-1 break-words font-semibold">{next.label}</h3>
        <p className="mt-2 break-words text-sm leading-6 [overflow-wrap:anywhere]">{next.reason}</p>
        <Link href={next.href}
          className="mt-3 inline-flex min-h-11 max-w-full items-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] [overflow-wrap:anywhere]">
          Go to this task
        </Link>
      </div>

      <nav className="mt-5" aria-label="Bid preparation steps">
        <ol className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {guidance.steps.map((step, index) => (
            <li key={step.id} className="min-w-0">
              <Link href={step.href}
                aria-current={next.stepId === step.id ? "step" : undefined}
                className="flex min-h-24 min-w-0 flex-col gap-1 rounded-xl border p-3 text-sm hover:bg-[var(--muted)]/45 focus-visible:outline-2 focus-visible:outline-offset-2">
                <span className="break-words font-semibold [overflow-wrap:anywhere]">
                  {index + 1}. {step.title}
                </span>
                <span className="text-xs font-medium">
                  {step.status}{step.optional ? " · Optional" : ""}{step.count ? ` · ${step.count} to check` : ""}
                </span>
                <span className="break-words text-xs leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                  {step.description}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {guidance.groupedIssues.length ? (
        <div className="mt-5 min-w-0">
          <h3 className="font-semibold">Unresolved final-review checks</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Grouped by work area; each underlying check remains distinct. Open a group for exact action links.
          </p>
          <div className="mt-3 grid min-w-0 gap-2">
            {guidance.groupedIssues.map((group) => (
              <details key={group.stepId} className="min-w-0 rounded-lg border p-3">
                <summary className="cursor-pointer break-words text-sm font-semibold">
                  {group.title} · {group.issues.length} check{group.issues.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-3 grid min-w-0 gap-2">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.requirementId ?? issue.sectionId ?? issue.documentId ?? index}-${index}`}
                      className="min-w-0 rounded-lg bg-[var(--muted)]/35 p-3 text-sm">
                      <p className="break-words leading-6 [overflow-wrap:anywhere]">{issue.message}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {issue.owner} · {issue.code.replaceAll("_", " ")}
                      </p>
                      <Link href={issue.href} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                        Open affected control
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">
        Manual AI drafting may incur charges and requires an explicit request. A draft is not an approved bid.
        govTract never submits to the external procurement portal.
      </p>
    </section>
  );
}
