import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Link2,
  ShieldCheck,
} from "lucide-react";

import { BidWorkspaceControl } from "@/components/bid-workspace-control";
import { getBidWorkspace } from "@/lib/bids/workspace";

export const dynamic = "force-dynamic";

type BidWorkspacePageProps = {
  params: Promise<{ id: string }>;
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

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-dashed bg-[var(--muted)]/35 p-4 text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
      {children}
    </div>
  );
}

export async function generateMetadata({ params }: BidWorkspacePageProps): Promise<Metadata> {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  return { title: workspace ? `Bid · ${workspace.title}` : "Bid workspace not found" };
}

export default async function BidWorkspacePage({ params }: BidWorkspacePageProps) {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  if (!workspace) notFound();

  const sourceRequirements = workspace.sourceRequirements?.requirements ?? [];
  const snapshot = workspace.sourceSnapshot;

  return (
    <main className="min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto min-w-0 max-w-6xl">
        <Link
          href="/bids"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="size-4" />
          Back to bids
        </Link>

        <header className="min-w-0 overflow-hidden rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[var(--accent-foreground)]">
                  {workspace.status.replaceAll("_", " ")}
                </span>
                <span className="rounded-full border px-2.5 py-1 text-[var(--muted-foreground)]">
                  Review {workspace.reviewState.replaceAll("_", " ")}
                </span>
                {snapshot.stale ? (
                  <span className="rounded-full border px-2.5 py-1">
                    Source changed
                  </span>
                ) : null}
              </div>

              <h1 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
                {workspace.title}
              </h1>
              <div className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
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
              </div>
            </div>
            <Link
              href={`/opportunities/${workspace.opportunityId}`}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)]"
            >
              View solicitation <Link2 className="size-4" />
            </Link>
          </div>
        </header>

        <div className="mt-5 grid min-w-0 gap-5">
          <BidWorkspaceControl
            workspaceId={workspace.id}
            initialStatus={workspace.status}
            initialReviewState={workspace.reviewState}
            initialNotes={workspace.notes}
          />

          <Section title="Source snapshot" icon={<ShieldCheck className="size-5" />}>
            {snapshot.stale ? (
              <div className="mb-4 flex min-w-0 gap-3 rounded-xl border p-4 text-sm leading-6">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  The authoritative document set has changed since the bid snapshot was prepared.
                  Review the newer solicitation documents before treating this workspace as current.
                </div>
              </div>
            ) : null}
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Status", snapshot.snapshotStatus],
                ["Documents", String(snapshot.totalDocumentCount)],
                ["Stored", String(snapshot.storedDocumentCount)],
                ["Blocked / failed", String(snapshot.blockedDocumentCount + snapshot.failedDocumentCount)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-xl bg-[var(--muted)]/45 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium capitalize [overflow-wrap:anywhere]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {snapshot.supersedesSnapshotId ? (
              <p className="mt-3 break-all text-xs text-[var(--muted-foreground)]">
                This snapshot supersedes {snapshot.supersedesSnapshotId}.
              </p>
            ) : null}
            {snapshot.documents.some((document) => document.status !== "stored") ? (
              <div className="mt-4 grid min-w-0 gap-2">
                {snapshot.documents
                  .filter((document) => document.status !== "stored")
                  .map((document) => (
                    <div
                      key={document.id}
                      className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {document.filename}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-[var(--muted-foreground)]">
                        {document.status}
                        {document.failureCode ? ` · ${document.failureCode}` : ""}
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
          </Section>

          <Section title="Source requirements" icon={<ClipboardCheck className="size-5" />}>
            {workspace.sourceRequirements ? (
              <div className="grid min-w-0 gap-4">
                <div className="flex min-w-0 flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full border px-2.5 py-1 capitalize">
                    {workspace.sourceRequirements.completenessStatus}
                  </span>
                  {workspace.sourceRequirements.isStale ? (
                    <span className="rounded-full border px-2.5 py-1">Understanding stale</span>
                  ) : null}
                  <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-foreground)]">
                    {sourceRequirements.length} structured requirement{sourceRequirements.length === 1 ? "" : "s"}
                  </span>
                </div>
                {sourceRequirements.length ? (
                  <div className="grid min-w-0 gap-2">
                    {sourceRequirements.slice(0, 12).map((requirement) => (
                      <div key={requirement.id} className="min-w-0 rounded-lg bg-[var(--muted)]/45 p-3">
                        <div className="flex min-w-0 flex-wrap gap-2 text-xs font-medium text-[var(--muted-foreground)]">
                          <span className="capitalize">{requirement.level}</span>
                          <span>·</span>
                          <span className="break-words [overflow-wrap:anywhere]">
                            {requirement.type.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                          {requirement.text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState>No structured source requirements have been materialized yet.</EmptyState>
                )}
              </div>
            ) : (
              <EmptyState>
                Solicitation understanding has not produced a structured source-requirement set yet.
              </EmptyState>
            )}
          </Section>

          <Section title="Compliance requirements" icon={<CheckCircle2 className="size-5" />}>
            {workspace.requirements.length ? (
              <div className="grid min-w-0 gap-2">
                {workspace.requirements.map((requirement) => (
                  <div key={requirement.id} className="min-w-0 rounded-lg border p-3">
                    <div className="flex min-w-0 flex-wrap gap-2 text-xs font-medium text-[var(--muted-foreground)]">
                      <span className="capitalize">{requirement.status.replaceAll("_", " ")}</span>
                      <span>·</span>
                      <span>{requirement.isRequired ? "Required" : "Optional"}</span>
                    </div>
                    <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                      {requirement.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>
                The compliance matrix has not been generated yet. #41 will convert source requirements
                into actionable bid requirements without changing the solicitation source of truth.
              </EmptyState>
            )}
          </Section>

          <Section title="Response sections" icon={<FileText className="size-5" />}>
            {workspace.sections.length ? (
              <div className="grid min-w-0 gap-3">
                {workspace.sections.map((section) => (
                  <article key={section.id} className="min-w-0 rounded-xl border p-4">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <h3 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
                        {section.title}
                      </h3>
                      <span className="shrink-0 text-xs font-medium capitalize text-[var(--muted-foreground)]">
                        {section.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    {section.instructions ? (
                      <p className="mt-2 break-words text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                        {section.instructions}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>
                No response outline exists yet. #42 will build the solicitation-specific response
                structure without regenerating AI content on workspace load.
              </EmptyState>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
