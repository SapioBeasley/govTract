import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, FileText, ShieldCheck } from "lucide-react";

import { BidFullDraftControl } from "@/components/bid-full-draft-control";
import { BidSourceRefreshAction } from "@/components/bid-source-refresh-action";
import { assessFullBidGenerationReadiness } from "@/lib/bids/full-bid";
import { getFullBidArtifact } from "@/lib/bids/full-bid-persistence";
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
  id,
  title,
  icon,
  children,
}: {
  id?: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 scroll-mt-5 overflow-hidden rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
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

export async function generateMetadata({ params }: BidWorkspacePageProps): Promise<Metadata> {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  return { title: workspace ? `Bid · ${workspace.title}` : "Bid workspace not found" };
}

export default async function BidWorkspacePage({ params }: BidWorkspacePageProps) {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  if (!workspace) notFound();
  const artifact = await getFullBidArtifact(workspace.id);
  const readiness = assessFullBidGenerationReadiness({
    snapshot: workspace.sourceSnapshot,
    requirements: workspace.sourceRequirements,
  });
  const sourceBlocker = readiness.ready ? null : readiness.blockers[0] ?? "Current source material is not ready.";
  const unavailableFiles = workspace.sourceSnapshot.documents.filter((document) => document.status !== "stored");

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
                {workspace.sourceSnapshot.stale ? (
                  <span className="rounded-full border px-2.5 py-1">Source changed</span>
                ) : (
                  <span className="rounded-full border px-2.5 py-1">Current source</span>
                )}
              </div>
              <h1 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
                {workspace.title}
              </h1>
              <div className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
                {workspace.agencyName ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Building2 className="size-4 shrink-0" />
                    <span className="break-words [overflow-wrap:anywhere]">{workspace.agencyName}</span>
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
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)]"
            >
              View solicitation
            </Link>
          </div>
        </header>

        <div className="mt-5 grid min-w-0 gap-5">
          <Section id="draft-bid" title="Draft bid" icon={<FileText className="size-5" />}>
            <p className="mb-4 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
              Generate one complete bid from the current solicitation package, then edit that saved response directly. Unknown company, product, pricing, or other bidder facts stay marked as Needs your input until you resolve them.
            </p>
            <BidFullDraftControl
              workspaceId={workspace.id}
              initialContent={artifact?.content ?? null}
              sourceBlocker={sourceBlocker}
            />
          </Section>

          <details
            id="source-details"
            open={Boolean(sourceBlocker)}
            className="min-w-0 scroll-mt-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-6"
          >
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">
              Source details
            </summary>
            <div className="mt-4 grid gap-4">
              <div className="flex items-start gap-3 rounded-xl bg-[var(--muted)]/35 p-4 text-sm leading-6">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
                <p>
                  Source provenance, amendment detection, document fingerprints, and stale checks run automatically. You do not need to complete a source-review checklist before drafting.
                </p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Snapshot", workspace.sourceSnapshot.snapshotStatus],
                  ["Documents", String(workspace.sourceSnapshot.totalDocumentCount)],
                  ["Stored", String(workspace.sourceSnapshot.storedDocumentCount)],
                  ["Unavailable", String(unavailableFiles.length)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border p-3">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-medium capitalize">{value}</dd>
                  </div>
                ))}
              </dl>
              {unavailableFiles.length ? (
                <div className="grid gap-2">
                  {unavailableFiles.map((document) => (
                    <div key={document.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="break-words">{document.filename}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {document.status}{document.failureCode ? ` · ${document.failureCode}` : ""}
                      </span>
                    </div>
                  ))}
                  <BidSourceRefreshAction workspaceId={workspace.id} unavailableCount={unavailableFiles.length} />
                </div>
              ) : null}
              {sourceBlocker && !unavailableFiles.length ? (
                <div className="rounded-xl border p-4 text-sm leading-6">
                  <p>{sourceBlocker}</p>
                  <Link
                    href={`/opportunities/${workspace.opportunityId}`}
                    className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
                  >
                    Open solicitation source and understanding
                  </Link>
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
