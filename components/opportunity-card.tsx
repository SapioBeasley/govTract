import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ExternalLink,
  Hash,
  MapPin,
  Tag,
} from "lucide-react";

import { QuickSaveButton } from "@/components/quick-save-button";
import type { OpportunityFeedItem } from "@/lib/opportunities/feed";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
  timeZoneName: "short",
});

function formatLocation(location: Record<string, unknown>) {
  const locality = typeof location.locality === "string" ? location.locality : null;
  const region = typeof location.region === "string" ? location.region : null;
  const country = typeof location.country === "string" ? location.country : null;

  return [locality, region, !locality && !region ? country : null].filter(Boolean).join(", ");
}

function formatSource(source: string) {
  if (source.toLowerCase() === "beacon") return "Beacon";
  if (source.toLowerCase() === "sam") return "SAM.gov";
  return source;
}

function getClassificationLabels(item: OpportunityFeedItem) {
  const preferred = item.classifications
    .filter((classification) => classification.scheme.toLowerCase() === "nigp")
    .slice(0, 3)
    .map((classification) =>
      classification.code
        ? `NIGP ${classification.code}`
        : classification.name,
    );

  if (preferred.length > 0) return preferred;
  return item.categories.slice(0, 3);
}

export function OpportunityCard({ item }: { item: OpportunityFeedItem }) {
  const location = formatLocation(item.location);
  const classifications = getClassificationLabels(item);
  const department = item.departments[0];

  return (
    <article className="rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[var(--accent-foreground)]">
            {formatSource(item.source)}
          </span>
          {item.status ? (
            <span className="rounded-full border px-2.5 py-1 capitalize text-[var(--muted-foreground)]">
              {item.status}
            </span>
          ) : null}
          {item.opportunityType ? (
            <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-foreground)]">
              {item.opportunityType}
            </span>
          ) : null}
        </div>

        <div>
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-[var(--foreground)]">
            <Link href={`/opportunities/${item.id}`} className="hover:text-[var(--primary)] hover:underline">
              {item.title}
            </Link>
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
            {item.agencyName ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-4" />
                {item.agencyName}
              </span>
            ) : null}
            {location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                {location}
              </span>
            ) : null}
            {item.solicitationNumber ? (
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-4" />
                {item.solicitationNumber}
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 rounded-xl bg-[var(--muted)]/60 p-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Posted
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 font-medium">
              <CalendarDays className="size-4" />
              {item.publishedAt ? dateFormatter.format(item.publishedAt) : "Not provided"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Deadline
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 font-medium">
              <CalendarDays className="size-4" />
              {item.dueAt ? dateFormatter.format(item.dueAt) : "Not provided"}
            </div>
          </div>
        </div>

        {department || classifications.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
            {department ? (
              <span className="rounded-full border px-2.5 py-1">{department}</span>
            ) : null}
            {classifications.map((classification) => (
              <span
                key={classification}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1"
              >
                <Tag className="size-3" />
                {classification}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <span className="text-[var(--muted-foreground)]">
            {item.categories[0] ?? "Category not provided"}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <QuickSaveButton opportunityId={item.id} />
            {item.canonicalUrl ? (
              <a
                href={item.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
              >
                Source
                <ExternalLink className="size-4" />
              </a>
            ) : null}
            <Link
              href={`/opportunities/${item.id}`}
              className="inline-flex items-center gap-1.5 font-semibold text-[var(--primary)] hover:underline"
            >
              View details
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
