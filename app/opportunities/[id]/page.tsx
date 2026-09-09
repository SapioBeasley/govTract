import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Hash,
  Info,
  MapPin,
  Scale,
  ShieldCheck,
  Tag,
} from "lucide-react";

import { getOpportunityDetail } from "@/lib/opportunities/detail";

export const dynamic = "force-dynamic";

type OpportunityDetailPageProps = {
  params: Promise<{ id: string }>;
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
  timeZoneName: "short",
});

function formatDate(value: Date | null) {
  return value ? dateTimeFormatter.format(value) : "Not provided";
}

function formatSource(source: string) {
  const normalized = source.toLowerCase();
  if (normalized === "beacon") return "Beacon";
  if (normalized === "sam" || normalized === "sam.gov" || normalized === "sam-gov") {
    return "SAM.gov";
  }
  return source;
}

function formatLocation(location: Record<string, unknown>) {
  const locality = typeof location.locality === "string" ? location.locality : null;
  const region = typeof location.region === "string" ? location.region : null;
  const country = typeof location.country === "string" ? location.country : null;
  const postalCode = typeof location.postalCode === "string" ? location.postalCode : null;

  const cityRegion = [locality, region].filter(Boolean).join(", ");
  return [cityRegion || country, postalCode].filter(Boolean).join(" ") || "Not provided";
}

function formatBytes(value: number | null) {
  if (value === null || value < 0) return "Size not provided";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function toPlainText(value: string | null) {
  if (!value) return null;

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-[var(--muted)]/40 p-4 text-sm leading-6 text-[var(--muted-foreground)]">
      {children}
    </div>
  );
}

function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[var(--primary)]">{icon}</span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export async function generateMetadata({ params }: OpportunityDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const opportunity = await getOpportunityDetail(id);

  return {
    title: opportunity ? opportunity.title : "Opportunity not found",
  };
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params;
  const opportunity = await getOpportunityDetail(id);

  if (!opportunity) notFound();

  const description = toPlainText(opportunity.description);
  const sourceUrl = opportunity.canonicalUrl ?? opportunity.sourceRecord?.canonicalUrl ?? null;
  const sourceRecord = opportunity.sourceRecord;

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/opportunities"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="size-4" />
          Back to opportunities
        </Link>

        <header className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[var(--accent-foreground)]">
                  {formatSource(opportunity.source)}
                </span>
                {opportunity.status ? (
                  <span className="rounded-full border px-2.5 py-1 capitalize text-[var(--muted-foreground)]">
                    {opportunity.status}
                  </span>
                ) : null}
                {opportunity.opportunityType ? (
                  <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-foreground)]">
                    {opportunity.opportunityType}
                  </span>
                ) : null}
              </div>

              <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                {opportunity.title}
              </h1>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-foreground)]">
                {opportunity.agencyName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-4" />
                    {opportunity.agencyName}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" />
                  {formatLocation(opportunity.location)}
                </span>
                {opportunity.solicitationNumber ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Hash className="size-4" />
                    {opportunity.solicitationNumber}
                  </span>
                ) : null}
              </div>
            </div>

            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
              >
                View original source
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 text-sm">
          {["At a Glance", "Understand", "Requirements", "Submission", "Evaluation", "Documents", "Intelligence", "Evidence"].map(
            (label) => (
              <a
                key={label}
                href={`#${label.toLowerCase().replace(/\s+/g, "-")}`}
                className="whitespace-nowrap rounded-full border bg-white px-3 py-1.5 font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              >
                {label}
              </a>
            ),
          )}
        </nav>

        <div className="mt-5 grid gap-5">
          <Section id="at-a-glance" title="At a Glance" icon={<Info className="size-5" />}>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Posted", formatDate(opportunity.publishedAt)],
                ["Issued", formatDate(opportunity.issueAt)],
                ["Deadline", formatDate(opportunity.dueAt)],
                ["Location", formatLocation(opportunity.location)],
                ["Agency", opportunity.agencyName ?? "Not provided"],
                ["Solicitation", opportunity.solicitationNumber ?? "Not provided"],
                ["Normalized status", opportunity.status ?? "Not provided"],
                ["Source status", opportunity.sourceStatus ?? "Not provided"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[var(--muted)]/55 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {opportunity.departments.length > 0 ||
            opportunity.categories.length > 0 ||
            opportunity.classifications.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {opportunity.departments.map((department) => (
                  <span key={`department-${department}`} className="rounded-full border px-2.5 py-1 text-xs">
                    {department}
                  </span>
                ))}
                {opportunity.classifications.map((classification) => (
                  <span
                    key={classification.id}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-[var(--muted-foreground)]"
                    title={classification.name}
                  >
                    <Tag className="size-3" />
                    {classification.scheme.toUpperCase()}
                    {classification.code ? ` ${classification.code}` : ""}
                  </span>
                ))}
                {opportunity.categories.slice(0, 6).map((category) => (
                  <span key={`category-${category}`} className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs">
                    {category}
                  </span>
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="understand" title="Understand" icon={<CheckCircle2 className="size-5" />}>
            {description ? (
              <div className="whitespace-pre-line text-sm leading-7 text-[var(--foreground)]">{description}</div>
            ) : (
              <EmptyState>
                The source did not provide a usable description. Document-backed solicitation understanding will appear here after the extraction and understanding pipeline is implemented.
              </EmptyState>
            )}
          </Section>

          <Section id="requirements" title="Requirements" icon={<ClipboardCheck className="size-5" />}>
            <EmptyState>
              Structured mandatory requirements have not been extracted yet. This section will surface requirements such as forms, insurance, bonding, licenses, certifications, pricing instructions, mandatory events, and disqualifiers with source evidence.
            </EmptyState>
          </Section>

          <Section id="submission" title="Submission" icon={<CalendarDays className="size-5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--muted)]/55 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Due</div>
                <div className="mt-1 font-medium">{formatDate(opportunity.dueAt)}</div>
              </div>
              <div className="rounded-xl bg-[var(--muted)]/55 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Submission instructions</div>
                <div className="mt-1 text-sm text-[var(--muted-foreground)]">Pending document extraction</div>
              </div>
            </div>
            {sourceUrl ? (
              <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                Verify the official submission method and any updated instructions on the original procurement source before responding.
              </p>
            ) : null}
          </Section>

          <Section id="evaluation" title="Evaluation" icon={<Scale className="size-5" />}>
            <EmptyState>
              Evaluation criteria have not been extracted yet. The page remains available while downstream understanding is pending or unavailable.
            </EmptyState>
          </Section>

          <Section id="documents" title={`Documents (${opportunity.documents.length})`} icon={<FileText className="size-5" />}>
            {opportunity.documents.length > 0 ? (
              <div className="divide-y rounded-xl border">
                {opportunity.documents.map((document) => (
                  <div key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{document.name}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                        <span>{document.mimeType ?? "Type not provided"}</span>
                        <span>{formatBytes(document.fileSizeBytes)}</span>
                        <span>Source key: {document.sourceDocumentKey}</span>
                      </div>
                    </div>
                    {document.url ? (
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--primary)] hover:underline"
                      >
                        Open document
                        <ExternalLink className="size-4" />
                      </a>
                    ) : (
                      <span className="shrink-0 rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
                        Retrieval pending
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No document metadata is currently attached to this opportunity.</EmptyState>
            )}
          </Section>

          <Section id="intelligence" title="Intelligence" icon={<ShieldCheck className="size-5" />}>
            <EmptyState>
              No reliable historical intelligence has been identified for this opportunity yet. Missing intelligence does not block the opportunity page or solicitation review.
            </EmptyState>
          </Section>

          <Section id="evidence" title="Evidence" icon={<Hash className="size-5" />}>
            {sourceRecord ? (
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Source", formatSource(opportunity.source)],
                  ["Source record ID", sourceRecord.sourceRecordId],
                  ["Source revision", sourceRecord.sourceRevisionId ?? opportunity.sourceRevisionId ?? "Not provided"],
                  ["Source agency", sourceRecord.sourceAgency ?? "Not provided"],
                  ["Source modified", formatDate(sourceRecord.sourceModifiedAt)],
                  ["Last observed", formatDate(sourceRecord.lastSeenAt)],
                  ["Payload hash", sourceRecord.payloadHash],
                  ["Canonical opportunity ID", opportunity.id],
                  ["Source active", sourceRecord.isActive ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-xl bg-[var(--muted)]/55 p-3">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
                    <dd className="mt-1 break-all font-mono text-xs leading-5">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState>Normalized opportunity data is available, but the contributing source record could not be loaded.</EmptyState>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
