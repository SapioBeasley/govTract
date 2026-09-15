import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarDays, Heart } from "lucide-react";

import { SavedOpportunityControl } from "@/components/saved-opportunity-control";
import {
  SAVED_OPPORTUNITY_STATUSES,
  isSavedOpportunityStatus,
  listSavedOpportunities,
  type SavedOpportunityStatus,
} from "@/lib/opportunities/saved";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saved",
};

type SavedPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_LABELS: Record<SavedOpportunityStatus, string> = {
  saved: "Saved",
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  no_bid: "No Bid",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
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

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SavedPage({ searchParams }: SavedPageProps) {
  const params = await searchParams;
  const rawStatus = first(params.status);
  const status = isSavedOpportunityStatus(rawStatus) ? rawStatus : undefined;
  const saved = await listSavedOpportunities({ status });

  return (
    <section className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)]">
              <Heart className="size-4" /> Pipeline
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Saved</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
              Organize opportunities from first review through pursuit, submission, and outcome.
            </p>
          </div>
          <Link
            href="/opportunities"
            className="inline-flex w-fit items-center rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)]"
          >
            Find opportunities
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/saved"
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              !status ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-white"
            }`}
          >
            All
          </Link>
          {SAVED_OPPORTUNITY_STATUSES.map((value) => (
            <Link
              key={value}
              href={`/saved?status=${value}`}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                status === value
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-white text-[var(--muted-foreground)]"
              }`}
            >
              {STATUS_LABELS[value]}
            </Link>
          ))}
        </div>

        <div className="mt-6">
          {saved.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
              <Heart className="mx-auto size-7 text-[var(--muted-foreground)]" />
              <h2 className="mt-3 font-semibold">No opportunities in this stage</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Save an opportunity from the feed or its detail page to start the pursuit pipeline.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {saved.map((item) => (
                <article key={item.id} className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[var(--accent-foreground)]">
                          {STATUS_LABELS[item.status]}
                        </span>
                        {item.priority > 0 ? (
                          <span className="rounded-full border px-2.5 py-1">Priority {item.priority}</span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                        <Link href={`/opportunities/${item.opportunityId}`} className="hover:text-[var(--primary)] hover:underline">
                          {item.title}
                        </Link>
                      </h2>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
                        {item.agencyName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Building2 className="size-4" /> {item.agencyName}
                          </span>
                        ) : null}
                        {item.dueAt ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="size-4" /> Due {dateFormatter.format(item.dueAt)}
                          </span>
                        ) : null}
                        {item.internalDeadline ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                            <CalendarDays className="size-4" /> Internal {dateFormatter.format(item.internalDeadline)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <SavedOpportunityControl
                      opportunityId={item.opportunityId}
                      initialSaved={{
                        status: item.status,
                        notes: item.notes,
                        priority: item.priority,
                        internalDeadline: item.internalDeadline?.toISOString() ?? null,
                        snapshotStatus: item.snapshotStatus,
                      }}
                    />
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
