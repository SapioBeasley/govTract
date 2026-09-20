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
  Tag,
} from "lucide-react";

import { OpportunityDocumentList } from "@/components/opportunity-document-list";
import { StartBidButton } from "@/components/start-bid-button";
import { UnderstandingActionButton } from "@/components/understanding-action-button";
import { getBidWorkspaceForOpportunity } from "@/lib/bids/workspace";
import { getOpportunityDetail } from "@/lib/opportunities/detail";
import { loadLatestSolicitationUnderstanding } from "@/lib/procurement/understanding/generation-persistence";
import type { SolicitationUnderstandingFinding } from "@/lib/procurement/understanding/types";

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
  if (normalized === "sam" || normalized === "sam.gov" || normalized === "sam-gov") return "SAM.gov";
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
    <div className="min-w-0 rounded-xl border border-dashed bg-[var(--muted)]/40 p-4 text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
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
    <section
      id={id}
      className="min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-4 flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[var(--primary)]">{icon}</span>
        <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function FindingList({ findings }: { findings: SolicitationUnderstandingFinding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No supported findings.</p>;
  }
  return (
    <ul className="grid min-w-0 gap-2 text-sm leading-6">
      {findings.map((finding) => (
        <li
          key={finding.key}
          className="min-w-0 break-words rounded-lg bg-[var(--muted)]/45 px-3 py-2 [overflow-wrap:anywhere]"
        >
          {finding.text}
        </li>
      ))}
    </ul>
  );
}

function FindingGroup({
  title,
  findings,
}: {
  title: string;
  findings: SolicitationUnderstandingFinding[];
}) {
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <FindingList findings={findings} />
    </div>
  );
}

export async function generateMetadata({ params }: OpportunityDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const opportunity = await getOpportunityDetail(id);
  return { title: opportunity ? opportunity.title : "Opportunity not found" };
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params;
  const opportunity = await getOpportunityDetail(id);
  if (!opportunity) notFound();

  const [understanding, existingWorkspace] = await Promise.all([
    loadLatestSolicitationUnderstanding(opportunity.id),
    getBidWorkspaceForOpportunity(opportunity.id),
  ]);
  const understandingContent = understanding?.structuredOutput ?? null;
  const description = toPlainText(opportunity.description);
  const sourceUrl = opportunity.canonicalUrl ?? opportunity.sourceRecord?.canonicalUrl ?? null;
  const sourceRecord = opportunity.sourceRecord;
  const documentItems = opportunity.documents.map((document) => ({
    id: document.id,
    name: document.name,
    url: document.url,
    mimeType: document.mimeType,
    fileSizeLabel: formatBytes(document.fileSizeBytes),
    sourceDocumentKey: document.sourceDocumentKey,
    extractionState: document.extractionState,
    latestVersion: document.latestVersion
      ? {
          versionNumber: document.latestVersion.versionNumber,
          checksumSha256: document.latestVersion.checksumSha256,
        }
      : null,
    extraction: document.extraction
      ? {
          status: document.extraction.status,
          checksumSha256: document.extraction.checksumSha256,
          extractorName: document.extraction.extractorName,
          extractorVersion: document.extraction.extractorVersion,
          extractedByteCount: document.extraction.extractedByteCount,
          extractedCharCount: document.extraction.extractedCharCount,
          segmentCount: document.extraction.segmentCount,
          truncated: document.extraction.truncated,
          failureCode: document.extraction.failureCode,
        }
      : null,
  }));

  return (
    <main className="min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto min-w-0 max-w-6xl">
        <Link
          href="/opportunities"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="size-4" />
          Back to opportunities
        </Link>

        <header className="min-w-0 overflow-hidden rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
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

              <h1 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">
                {opportunity.title}
              </h1>

              <div className="mt-4 flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-foreground)]">
                {opportunity.agencyName ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Building2 className="size-4 shrink-0" />
                    <span className="break-words [overflow-wrap:anywhere]">{opportunity.agencyName}</span>
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4 shrink-0" />
                  {formatLocation(opportunity.location)}
                </span>
                {opportunity.solicitationNumber ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Hash className="size-4 shrink-0" />
                    <span className="break-all">{opportunity.solicitationNumber}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:flex-col">
              <StartBidButton
                opportunityId={opportunity.id}
                workspaceId={existingWorkspace?.id ?? null}
              />
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)]"
                >
                  View original source <ExternalLink className="size-4" />
                </a>
              ) : null}
            </div>
          </div>
        </header>

        <nav className="mt-5 flex max-w-full flex-wrap gap-2 pb-1 text-sm" aria-label="Solicitation sections">
          {["At a Glance", "Understand", "Requirements", "Submission", "Evaluation Criteria", "Documents", "Evidence"].map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="whitespace-nowrap rounded-full border bg-white px-3 py-1.5 font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-5 grid min-w-0 gap-5">
          <Section id="at-a-glance" title="At a Glance" icon={<Info className="size-5" />}>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <div key={label} className="min-w-0 rounded-xl bg-[var(--muted)]/55 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>

            {opportunity.departments.length || opportunity.categories.length || opportunity.classifications.length ? (
              <div className="mt-5 flex min-w-0 flex-wrap gap-2">
                {opportunity.departments.map((department) => (
                  <span
                    key={`department-${department}`}
                    className="max-w-full break-words rounded-full border px-2.5 py-1 text-xs [overflow-wrap:anywhere]"
                  >
                    {department}
                  </span>
                ))}
                {opportunity.classifications.map((classification) => (
                  <span
                    key={classification.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-[var(--muted-foreground)]"
                    title={classification.name}
                  >
                    <Tag className="size-3 shrink-0" /> {classification.scheme.toUpperCase()}
                    {classification.code ? ` ${classification.code}` : ""}
                  </span>
                ))}
                {opportunity.categories.slice(0, 6).map((category) => (
                  <span
                    key={`category-${category}`}
                    className="max-w-full break-words rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs [overflow-wrap:anywhere]"
                  >
                    {category}
                  </span>
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="understand" title="Understand" icon={<CheckCircle2 className="size-5" />}>
            <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-wrap gap-2 text-xs font-medium">
                {understandingContent ? (
                  <span className="rounded-full border px-2.5 py-1 capitalize">
                    {understanding?.completenessStatus ?? "partial"}
                  </span>
                ) : null}
                {understanding?.isStale ? (
                  <span className="rounded-full border px-2.5 py-1">Stale</span>
                ) : null}
                {understanding?.incompleteReason ? (
                  <span className="max-w-full break-words rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                    {understanding.incompleteReason.replaceAll("_", " ")}
                  </span>
                ) : null}
              </div>
              <UnderstandingActionButton
                opportunityId={opportunity.id}
                hasUnderstanding={Boolean(understandingContent)}
              />
            </div>

            {understandingContent ? (
              <div className="grid min-w-0 gap-4">
                <p className="break-words text-sm leading-7 [overflow-wrap:anywhere]">
                  {understandingContent.summary}
                </p>
                {understandingContent.questionsAmbiguities.length ? (
                  <FindingGroup title="Questions / ambiguities" findings={understandingContent.questionsAmbiguities} />
                ) : null}
              </div>
            ) : description ? (
              <div className="grid min-w-0 gap-3">
                <div className="whitespace-pre-line break-words text-sm leading-7 [overflow-wrap:anywhere]">
                  {description}
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  This is source description text, not a generated solicitation understanding.
                </p>
              </div>
            ) : (
              <EmptyState>
                The source did not provide a usable description. Generate understanding after document extraction is available.
              </EmptyState>
            )}
          </Section>

          <Section id="requirements" title="Requirements" icon={<ClipboardCheck className="size-5" />}>
            {understandingContent ? (
              <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                <FindingGroup title="Scope" findings={understandingContent.scope} />
                <FindingGroup title="Work breakdown" findings={understandingContent.workBreakdown} />
                <FindingGroup title="Deliverables" findings={understandingContent.deliverables} />
                <FindingGroup title="Qualifications" findings={understandingContent.qualifications} />
                <FindingGroup title="Insurance / bonding" findings={understandingContent.insuranceBonding} />
                <FindingGroup title="Mandatory events" findings={understandingContent.mandatoryEvents} />
                <FindingGroup title="Quantities" findings={understandingContent.quantities} />
                <FindingGroup title="Disqualifiers" findings={understandingContent.disqualifiers} />
              </div>
            ) : (
              <EmptyState>Structured mandatory requirements have not been generated yet.</EmptyState>
            )}
          </Section>

          <Section id="submission" title="Submission" icon={<CalendarDays className="size-5" />}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl bg-[var(--muted)]/55 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Due</div>
                <div className="mt-1 break-words font-medium [overflow-wrap:anywhere]">
                  {formatDate(opportunity.dueAt)}
                </div>
              </div>
              {understandingContent ? (
                <FindingGroup title="Submission components" findings={understandingContent.submissionComponents} />
              ) : (
                <div className="min-w-0 rounded-xl bg-[var(--muted)]/55 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    Submission instructions
                  </div>
                  <div className="mt-1 text-sm text-[var(--muted-foreground)]">Pending structured understanding</div>
                </div>
              )}
            </div>
            {understandingContent ? (
              <div className="mt-3">
                <FindingGroup title="Pricing instructions" findings={understandingContent.pricingInstructions} />
              </div>
            ) : null}
            {sourceUrl ? (
              <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                Verify the official submission method and updated instructions on the original procurement source before responding.
              </p>
            ) : null}
          </Section>

          <Section id="evaluation-criteria" title="Evaluation Criteria" icon={<Scale className="size-5" />}>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">These are the buyer’s criteria for evaluating bids, not a market-entry recommendation.</p>
            {understandingContent ? (
              <FindingList findings={understandingContent.evaluationCriteria} />
            ) : (
              <EmptyState>Evaluation criteria have not been structured yet.</EmptyState>
            )}
          </Section>

          <Section id="documents" title={`Documents (${opportunity.documents.length})`} icon={<FileText className="size-5" />}>
            {documentItems.length ? (
              <OpportunityDocumentList opportunityId={opportunity.id} documents={documentItems} />
            ) : (
              <EmptyState>No document metadata is currently attached to this opportunity.</EmptyState>
            )}
          </Section>

          <Section id="evidence" title="Evidence" icon={<Hash className="size-5" />}>
            {sourceRecord ? (
              <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
