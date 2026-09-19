import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarDays, FileText, ShieldCheck } from "lucide-react";

import { listBidWorkspaces, type BidWorkspaceStatus } from "@/lib/bids/workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bids",
};

const STATUS_LABELS: Record<BidWorkspaceStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  complete: "Complete",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
  timeZoneName: "short",
});

function snapshotLabel(status: string, stale: boolean) {
  if (stale) return "Source changed · review required";
  if (status === "complete") return "Source snapshot complete";
  if (status === "blocked") return "Source snapshot blocked";
  if (status === "incomplete") return "Source snapshot incomplete";
  return "Source snapshot pending";
}

export default async function BidsPage() {
  const workspaces = await listBidWorkspaces();

  return (
    <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)]">
              <FileText className="size-4" /> Respond
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bids</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
              Prepare solicitation-specific response workspaces using the exact source documents,
              requirements, notes, and review state for each pursuit.
            </p>
          </div>
          <Link
            href="/opportunities"
            className="inline-flex w-fit items-center rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)]"
          >
            Find opportunities
          </Link>
        </div>

        <div className="mt-6">
          {workspaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
              <FileText className="mx-auto size-7 text-[var(--muted-foreground)]" />
              <h2 className="mt-3 font-semibold">No bid workspaces yet</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Open an opportunity and choose Pursue / Start bid to create the workspace.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {workspaces.map((workspace) => (
                <article
                  key={workspace.id}
                  className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[var(--accent-foreground)]">
                          {STATUS_LABELS[workspace.status]}
                        </span>
                        <span className="max-w-full break-words rounded-full border px-2.5 py-1 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                          {snapshotLabel(workspace.snapshotStatus, workspace.snapshotStale)}
                        </span>
                      </div>
                      <h2 className="mt-3 min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                        <Link
                          href={`/bids/${workspace.id}`}
                          className="hover:text-[var(--primary)] hover:underline"
                        >
                          {workspace.title}
                        </Link>
                      </h2>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
                        {workspace.agencyName ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <Building2 className="size-4 shrink-0" />
                            <span className="break-words [overflow-wrap:anywhere]">
                              {workspace.agencyName}
                            </span>
                          </span>
                        ) : null}
                        {workspace.dueAt ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="size-4 shrink-0" />
                            Due {dateFormatter.format(workspace.dueAt)}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="size-4 shrink-0" />
                          Review {workspace.reviewState.replaceAll("_", " ")}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/bids/${workspace.id}`}
                      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
                    >
                      Open workspace
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
