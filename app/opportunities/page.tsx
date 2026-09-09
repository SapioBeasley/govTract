import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  MapPin,
  Search,
  SlidersHorizontal,
  Target,
} from "lucide-react";

import { OpportunityCard } from "@/components/opportunity-card";
import {
  getOpportunityFeed,
  getOpportunityFeedFacets,
  type OpportunityFeedLevel,
  type OpportunityFeedMarket,
  type OpportunityFeedSort,
} from "@/lib/opportunities/feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Opportunities",
};

type RawSearchParams = Record<string, string | string[] | undefined>;

type OpportunitiesPageProps = {
  searchParams: Promise<RawSearchParams>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveMarket(value: string | string[] | undefined): OpportunityFeedMarket {
  return first(value) === "all" ? "all" : "houston";
}

function resolveNumber(value: string | string[] | undefined, allowed: number[]) {
  const parsed = Number(first(value));
  return allowed.includes(parsed) ? parsed : undefined;
}

function resolveLevel(value: string | string[] | undefined): OpportunityFeedLevel | undefined {
  const resolved = first(value);
  return resolved === "federal" || resolved === "local" ? resolved : undefined;
}

function resolveSort(
  value: string | string[] | undefined,
  hasQuery: boolean,
): OpportunityFeedSort {
  const resolved = first(value);
  if (resolved === "relevance" || resolved === "newest" || resolved === "deadline") {
    return resolved;
  }
  return hasQuery ? "relevance" : "deadline";
}

function resolvePage(value: string | string[] | undefined) {
  const parsed = Number.parseInt(first(value) ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizedSearchParams(params: RawSearchParams) {
  const result = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    const value = first(rawValue);
    if (value) result.set(key, value);
  }
  return result;
}

function buildHref(
  current: URLSearchParams,
  updates: Record<string, string | number | null | undefined>,
) {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  if (!Object.prototype.hasOwnProperty.call(updates, "page")) {
    next.delete("page");
  }

  const query = next.toString();
  return query ? `/opportunities?${query}` : "/opportunities";
}

function formatSource(source: string) {
  const normalized = source.toLowerCase();
  if (normalized === "beacon") return "Beacon";
  if (normalized === "sam" || normalized === "sam.gov" || normalized === "sam-gov") {
    return "SAM.gov";
  }
  return source;
}

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const params = await searchParams;
  const market = resolveMarket(params.market);
  const query = (first(params.q) ?? "").trim();
  const source = first(params.source) || undefined;
  const agency = first(params.agency) || undefined;
  const geography = (first(params.geography) ?? "").trim() || undefined;
  const deadlineDays = resolveNumber(params.deadline, [7, 14, 30, 60]);
  const postedDays = resolveNumber(params.posted, [1, 7, 30, 90]);
  const status = first(params.status) || undefined;
  const opportunityType = first(params.type) || undefined;
  const naics = (first(params.naics) ?? "").trim() || undefined;
  const level = resolveLevel(params.level);
  const sort = resolveSort(params.sort, Boolean(query));
  const requestedPage = resolvePage(params.page);

  const [result, facets] = await Promise.all([
    getOpportunityFeed({
      market,
      query: query || undefined,
      source,
      agency,
      geography,
      deadlineDays,
      postedDays,
      status,
      opportunityType,
      naics,
      level,
      sort,
      page: requestedPage,
      pageSize: 12,
    }),
    getOpportunityFeedFacets(market),
  ]);

  const currentParams = normalizedSearchParams(params);
  const now = Date.now();
  const dueSoon = result.items.filter((item) => {
    if (!item.dueAt) return false;
    const remaining = item.dueAt.getTime() - now;
    return remaining >= 0 && remaining <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const agenciesOnPage = new Set(
    result.items.map((item) => item.agencyName).filter(Boolean),
  ).size;
  const locationsOnPage = new Set(
    result.items
      .map((item) => {
        const locality = typeof item.location.locality === "string" ? item.location.locality : null;
        const region = typeof item.location.region === "string" ? item.location.region : null;
        return [locality, region].filter(Boolean).join(", ");
      })
      .filter(Boolean),
  ).size;

  const quickFilters = [
    {
      label: "Houston",
      active: market === "houston" && !level,
      href: buildHref(currentParams, { market: null, level: null }),
    },
    {
      label: "Closing Soon",
      active: deadlineDays === 7,
      href: buildHref(currentParams, { deadline: deadlineDays === 7 ? null : 7 }),
    },
    {
      label: "New",
      active: postedDays === 7,
      href: buildHref(currentParams, { posted: postedDays === 7 ? null : 7 }),
    },
    {
      label: "Federal",
      active: level === "federal",
      href: buildHref(currentParams, { market: "all", level: "federal" }),
    },
    {
      label: "Local",
      active: level === "local",
      href: buildHref(currentParams, { market: "all", level: "local" }),
    },
  ];

  const activeFilterCount = [
    query,
    source,
    agency,
    geography,
    deadlineDays,
    postedDays,
    status,
    opportunityType,
    naics,
    level,
  ].filter(Boolean).length;

  const firstResult = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastResult = Math.min(result.page * result.pageSize, result.total);
  const pageNumbers = Array.from({ length: result.pageCount }, (_, index) => index + 1).filter(
    (pageNumber) =>
      pageNumber === 1 ||
      pageNumber === result.pageCount ||
      Math.abs(pageNumber - result.page) <= 2,
  );

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
              Search and filter normalized procurement opportunities. Houston remains the default launch
              view while the underlying feed stays source- and geography-agnostic.
            </p>
          </div>

          <div className="inline-flex w-fit rounded-xl border bg-white p-1 shadow-sm">
            <Link
              href={buildHref(currentParams, { market: null })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                market === "houston"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              Houston
            </Link>
            <Link
              href={buildHref(currentParams, { market: "all" })}
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

        <div className="mt-6 flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <Link
              key={filter.label}
              href={filter.href}
              aria-current={filter.active ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                filter.active
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-white text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              {filter.label}
            </Link>
          ))}
          <button
            type="button"
            disabled
            title="Available after the matching engine is implemented"
            className="cursor-not-allowed rounded-full border border-dashed bg-[var(--muted)]/50 px-3 py-1.5 text-sm font-medium text-[var(--muted-foreground)] opacity-70"
          >
            Best Matches · pending match data
          </button>
          <button
            type="button"
            disabled
            title="Available after the saved-opportunity pipeline is implemented"
            className="cursor-not-allowed rounded-full border border-dashed bg-[var(--muted)]/50 px-3 py-1.5 text-sm font-medium text-[var(--muted-foreground)] opacity-70"
          >
            Saved · pending saved state
          </button>
        </div>

        <form method="get" action="/opportunities" className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          {market === "all" ? <input type="hidden" name="market" value="all" /> : null}
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" />
            Search & filters
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                {activeFilterCount} active
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-12">
            <label className="lg:col-span-6">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Search
              </span>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Title, solicitation, agency, scope, NAICS, category…"
                  className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10"
                />
              </div>
            </label>

            <label className="lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Source
              </span>
              <select
                name="source"
                defaultValue={source ?? ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">All sources</option>
                {facets.sources.map((value) => (
                  <option key={value} value={value}>
                    {formatSource(value)}
                  </option>
                ))}
              </select>
            </label>

            <label className="lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Agency
              </span>
              <select
                name="agency"
                defaultValue={agency ?? ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">All agencies</option>
                {facets.agencies.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="sm:col-span-1 lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Geography
              </span>
              <input
                name="geography"
                defaultValue={geography ?? ""}
                placeholder="City, state, region"
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              />
            </label>

            <label className="lg:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Deadline
              </span>
              <select
                name="deadline"
                defaultValue={deadlineDays ? String(deadlineDays) : ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">Any deadline</option>
                <option value="7">Next 7 days</option>
                <option value="14">Next 14 days</option>
                <option value="30">Next 30 days</option>
                <option value="60">Next 60 days</option>
              </select>
            </label>

            <label className="lg:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Posted
              </span>
              <select
                name="posted"
                defaultValue={postedDays ? String(postedDays) : ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">Any posting date</option>
                <option value="1">Last 24 hours</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>

            <label className="lg:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Status
              </span>
              <select
                name="status"
                defaultValue={status ?? ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm capitalize"
              >
                <option value="">All statuses</option>
                {facets.statuses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Opportunity type
              </span>
              <select
                name="type"
                defaultValue={opportunityType ?? ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">All types</option>
                {facets.opportunityTypes.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="lg:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                NAICS
              </span>
              <input
                name="naics"
                defaultValue={naics ?? ""}
                inputMode="numeric"
                placeholder="e.g. 541512"
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              />
            </label>

            <label className="lg:col-span-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Jurisdiction
              </span>
              <select
                name="level"
                defaultValue={level ?? ""}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="">Federal + local</option>
                <option value="federal">Federal</option>
                <option value="local">Local / non-federal</option>
              </select>
            </label>

            <label className="lg:col-span-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Sort
              </span>
              <select
                name="sort"
                defaultValue={sort}
                className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm"
              >
                <option value="relevance">Relevance</option>
                <option value="newest">Newest</option>
                <option value="deadline">Deadline</option>
                <option disabled>Best match — pending match scores</option>
                <option disabled>Estimated value — pending normalized value</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="rounded-full border border-dashed px-2.5 py-1">Set-aside: pending normalized field</span>
              <span className="rounded-full border border-dashed px-2.5 py-1">Match score: pending #30</span>
              <span className="rounded-full border border-dashed px-2.5 py-1">Saved state: pending #39</span>
            </div>
            <div className="flex gap-2">
              <Link
                href="/opportunities"
                className="inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                Reset
              </Link>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]"
              >
                Apply filters
              </button>
            </div>
          </div>
        </form>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Database className="size-4" />
              Filtered opportunities
            </div>
            <div className="mt-2 text-2xl font-semibold">{result.total}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Clock3 className="size-4" />
              Page closing in 7 days
            </div>
            <div className="mt-2 text-2xl font-semibold">{dueSoon}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <Building2 className="size-4" />
              Agencies on page
            </div>
            <div className="mt-2 text-2xl font-semibold">{agenciesOnPage}</div>
          </div>
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              <MapPin className="size-4" />
              Locations on page
            </div>
            <div className="mt-2 text-2xl font-semibold">{locationsOnPage}</div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {market === "houston" ? "Houston opportunities" : "All opportunities"}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {firstResult}–{lastResult} of {result.total} results · sorted by {sort}.
            </p>
          </div>
          <div className="text-sm text-[var(--muted-foreground)]">
            Page {result.page} of {result.pageCount}
          </div>
        </div>

        {result.items.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {result.items.map((item) => (
              <OpportunityCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed bg-white p-10 text-center">
            <h2 className="font-semibold">No opportunities match these filters</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Broaden the search, clear a filter, or switch between Houston and the full dataset.
            </p>
            <Link
              href="/opportunities"
              className="mt-4 inline-flex rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
            >
              Reset discovery
            </Link>
          </div>
        )}

        {result.pageCount > 1 ? (
          <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Opportunity pages">
            <Link
              href={buildHref(currentParams, { page: Math.max(1, result.page - 1) })}
              aria-disabled={result.page === 1}
              className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm font-medium ${
                result.page === 1
                  ? "pointer-events-none opacity-40"
                  : "bg-white hover:bg-[var(--muted)]"
              }`}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Link>

            {pageNumbers.map((pageNumber, index) => {
              const previousPage = pageNumbers[index - 1];
              const showGap = previousPage && pageNumber - previousPage > 1;
              return (
                <div key={pageNumber} className="contents">
                  {showGap ? <span className="px-1 text-[var(--muted-foreground)]">…</span> : null}
                  <Link
                    href={buildHref(currentParams, { page: pageNumber })}
                    aria-current={pageNumber === result.page ? "page" : undefined}
                    className={`inline-flex size-9 items-center justify-center rounded-lg border text-sm font-medium ${
                      pageNumber === result.page
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-white hover:bg-[var(--muted)]"
                    }`}
                  >
                    {pageNumber}
                  </Link>
                </div>
              );
            })}

            <Link
              href={buildHref(currentParams, { page: Math.min(result.pageCount, result.page + 1) })}
              aria-disabled={result.page === result.pageCount}
              className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm font-medium ${
                result.page === result.pageCount
                  ? "pointer-events-none opacity-40"
                  : "bg-white hover:bg-[var(--muted)]"
              }`}
            >
              Next
              <ChevronRight className="size-4" />
            </Link>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
