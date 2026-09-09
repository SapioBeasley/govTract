import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Clock3, Database, MapPin, Target } from "lucide-react";

import { OpportunityCard } from "@/components/opportunity-card";
import {
  getOpportunityFeed,
  type OpportunityFeedMarket,
} from "@/lib/opportunities/feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Opportunities",
};

type OpportunitiesPageProps = {
  searchParams: Promise<{
    market?: string | string[];
  }>;
};

function resolveMarket(value: string | string[] | undefined): OpportunityFeedMarket {
  return value === "all" ? "all" : "houston";
}

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const params = await searchParams;
  const market = resolveMarket(params.market);
  const items = await getOpportunityFeed(market);
  const now = Date.now();
  const dueSoon = items.filter((item) => {
    if (!item.dueAt) return false;
    const remaining = item.dueAt.getTime() - now;
    return remaining >= 0 && remaining <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const agencies = new Set(items.map((item) => item.agencyName).filter(Boolean)).size;
  const locations = new Set(
    items
      .map((item) => {
        const locality =
          typeof item.location.locality === "string" ? item.location.locality : null;
        const region = typeof item.location.region === "string" ? item.location.region : null;
        return [locality, region].filter(Boolean).join(", ");
      })
      .filter(Boolean),
  ).size;

  return (
    <section className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)]">
              <Target className="size-4" />
              Discover
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Opportunities</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
              Live normalized procurement opportunities from the govTract database. Houston stays the
              default launch view without limiting the underlying opportunity dataset.
            </p>
          </div>

          <div className="inline-flex w-fit rounded-xl border bg-white p-1 shadow-sm">
            <Link
              href="/opportunities"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                market === "houston"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              Houston
            </Link>
            <Link
              href="/opportunities?market=all"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                market === "all"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              All
            </Link>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Database className="size-4" />
              Active opportunities
            </div>
            <div className="mt-2 text-2xl font-semibold">{items.length}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Clock3 className="size-4" />
              Closing in 7 days
            </div>
            <div className="mt-2 text-2xl font-semibold">{dueSoon}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Building2 className="size-4" />
              Agencies
            </div>
            <div className="mt-2 text-2xl font-semibold">{agencies}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <MapPin className="size-4" />
              Locations
            </div>
            <div className="mt-2 text-2xl font-semibold">{locations}</div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {market === "houston" ? "Houston opportunities" : "All opportunities"}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Ordered by the nearest known solicitation deadline.
            </p>
          </div>
          <div className="text-sm text-[var(--muted-foreground)]">
            {items.length} {items.length === 1 ? "result" : "results"}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <OpportunityCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed bg-white p-10 text-center">
            <h2 className="font-semibold">No active opportunities found</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              The feed is connected, but this view does not currently contain active records.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
