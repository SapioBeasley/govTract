import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, ExternalLink, ShieldCheck } from "lucide-react";

import { FullBidEditor } from "@/components/full-bid-editor";
import { BidSourceRefreshAction } from "@/components/bid-source-refresh-action";
import { findFullBidSection, generationBlockers } from "@/lib/bids/full-bid";
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

export async function generateMetadata({ params }: BidWorkspacePageProps): Promise<Metadata> {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  return { title: workspace ? `Bid · ${workspace.title}` : "Bid workspace not found" };
}

export default async function BidWorkspacePage({ params }: BidWorkspacePageProps) {
  const { id } = await params;
  const workspace = await getBidWorkspace(id);
  if (!workspace) notFound();

  const fullBid = findFullBidSection(workspace.sections);
  const blockers = generationBlockers({
    snapshot: workspace.sourceSnapshot,
    requirements: workspace.sourceRequirements,
  });
  const missingSourceCount = workspace.sourceSnapshot.documents.filter((document) => document.status !== "stored").length;

  return (
    <main className="min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto min-w-0 max-w-5xl">
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
                {workspace.finalReviewApprovalCurrent ? (
                  <span className="rounded-full border px-2.5 py-1">Package approved</span>
                ) : null}
                {workspace.sourceSnapshot.stale ? (
                  <span className="rounded-full border px-2.5 py-1">Source changed</span>
                ) : null}
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
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)]"
            >
              View solicitation <ExternalLink className="size-4" />
            </Link>
          </div>
        </header>

        <div className="mt-5">
          <FullBidEditor
            workspaceId={workspace.id}
            sectionId={fullBid?.id ?? null}
            initialContent={fullBid?.content ?? ""}
            generationBlockers={blockers}
            supportingItems={workspace.finalReview.sourceChecks.map((item) => ({
              requirementId: item.requirementId,
              text: item.text,
              kind: item.kind,
              mandatory: item.mandatory,
              originalConfirmed: item.originalConfirmed,
            }))}
            confirmedSupportingItems={workspace.confirmedOriginalForms}
            readyForHumanReview={workspace.finalReview.readyForHumanReview}
            approvalCurrent={workspace.finalReviewApprovalCurrent}
          />
        </div>

        {workspace.finalReview.blockingIssues.length ? (
          <details className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold">
              Package blockers ({workspace.finalReview.blockingIssues.length})
            </summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
              {workspace.finalReview.blockingIssues.map((issue, index) => (
                <li key={`${issue.code}-${issue.requirementId ?? issue.sectionId ?? issue.documentId ?? index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details
          open={missingSourceCount > 0 || workspace.sourceSnapshot.stale}
          className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <summary className="cursor-pointer text-sm font-semibold">Source package status</summary>
          <div className="mt-4 grid gap-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-[var(--muted)]/45 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Snapshot</p>
                <p className="mt-1 font-medium capitalize">{workspace.sourceSnapshot.snapshotStatus}</p>
              </div>
              <div className="rounded-xl bg-[var(--muted)]/45 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Documents</p>
                <p className="mt-1 font-medium">{workspace.sourceSnapshot.storedDocumentCount} / {workspace.sourceSnapshot.totalDocumentCount} stored</p>
              </div>
              <div className="rounded-xl bg-[var(--muted)]/45 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Understanding</p>
                <p className="mt-1 font-medium capitalize">{workspace.sourceRequirements?.completenessStatus ?? "unavailable"}</p>
              </div>
            </div>
            {missingSourceCount > 0 ? (
              <BidSourceRefreshAction workspaceId={workspace.id} unavailableCount={missingSourceCount} />
            ) : null}
            <p className="flex items-start gap-2 text-xs leading-5 text-[var(--muted-foreground)]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              Source retention, provenance, amendment detection, and version fingerprints remain internal safeguards.
              You do not need to verify buyer documents one-by-one before drafting.
            </p>
          </div>
        </details>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">External submission handoff</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            govTract prepares the package but does not claim submission unless a supported submission integration exists.
            Follow the authoritative solicitation instructions and retain the external portal receipt.
          </p>
          {workspace.submissionUrl ? (
            <a
              href={workspace.submissionUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              Open authoritative opportunity <ExternalLink className="size-4" />
            </a>
          ) : null}
        </section>
      </div>
    </main>
  );
}
