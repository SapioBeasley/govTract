import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Link2,
  ShieldCheck,
} from "lucide-react";

import { BidWorkspaceControl } from "@/components/bid-workspace-control";
import { BidOutlineControl } from "@/components/bid-outline-control";
import { BidFinalReview } from "@/components/bid-final-review";
import { GuidedBidProgress } from "@/components/guided-bid-progress";
import { BidSourceRefreshAction } from "@/components/bid-source-refresh-action";
import { BidSourceReconciliationAction } from "@/components/bid-source-reconciliation-action";
import { getPursuitSnapshot } from "@/lib/procurement/pursuits/snapshot";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { savedSectionCanAddressRequirement } from "@/lib/bids/response-proof";
import { groupBidBuilderRequirements } from "@/lib/bids/builder";
import { listBidDraftGenerations } from "@/lib/bids/draft-persistence";

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
  const generations = await listBidDraftGenerations(workspace.id);

  const sourceRequirements = workspace.sourceRequirements?.requirements ?? [];
  const sourceEligible = Boolean(workspace.sourceRequirements && !workspace.sourceRequirements.isStale &&
    (workspace.sourceRequirements.completenessStatus === "complete" ||
      (workspace.sourceRequirements.completenessStatus === "partial" &&
        workspace.sourceRequirements.incompleteReasons.length > 0 &&
        workspace.sourceRequirements.incompleteReasons.every((reason) => reason === "requirement_evidence_missing"))));
  const builderGroups = groupBidBuilderRequirements(workspace.requirements, workspace.sections,
    workspace.sourceRequirements?.understandingId ?? null,
    workspace.sourceRequirements?.requirements ?? []);
  const snapshot = workspace.sourceSnapshot;
  const previousSnapshot = snapshot.supersedesSnapshotId
    ? await getPursuitSnapshot(snapshot.supersedesSnapshotId)
    : null;
  const previousVersionIds = new Set(previousSnapshot?.documents.map((document) =>
    document.opportunityDocumentVersionId) ?? snapshot.documents.map((document) =>
    document.opportunityDocumentVersionId));
  const outlineNeedsReconciliation = workspace.sections.some((section) =>
    section.metadata.understandingId !== workspace.sourceRequirements?.understandingId ||
    section.metadata.pursuitSnapshotId !== snapshot.pursuitSnapshotId ||
    section.metadata.documentSetFingerprint !== snapshot.documentSetFingerprint);
  const showSourceReconciliation = Boolean(snapshot.stale || workspace.sourceRequirements?.isStale ||
    workspace.sourceRequirements?.completenessStatus !== "complete" ||
    outlineNeedsReconciliation);
  const missingEvidence = sourceRequirements.filter((requirement) =>
    !requirement.listingEvidence &&
    (!requirement.evidence.length || requirement.evidence.some((proof) => !proof.excerpt?.trim())));
  const pendingFiles = snapshot.documents.filter((document) => document.status === "pending");
  const unavailableFiles = snapshot.documents.filter((document) =>
    document.status !== "stored" && document.status !== "pending");
  const sourceBlockers = [
    pendingFiles.length
      ? `${pendingFiles.length} original source file(s) are queued but not stored: ${pendingFiles.map((file) => file.filename).join(", ")}. Use Retrieve source files in the Source snapshot section; if unavailable, use the bounded Beacon snapshot batch in GitHub Actions.`
      : null,
    unavailableFiles.length
      ? `Source retrieval failed or was blocked for: ${unavailableFiles.map((file) => `${file.filename} (${file.failureCode ?? file.status})`).join(", ")}. Check source access and rerun the pursuit-snapshot job; do not draft without these files.`
      : null,
    snapshot.snapshotStatus !== "complete" && !pendingFiles.length && !unavailableFiles.length
      ? "The original solicitation package has not been fully retained. Check the pursuit-snapshot job before drafting."
      : null,
    snapshot.stale || snapshot.documentSetFingerprint !== snapshot.currentDocumentSetFingerprint
      ? "An authoritative source document or amendment has changed. Refresh and review the preserved snapshot and response outline."
      : null,
    missingEvidence.length
      ? `${missingEvidence.length} requirement(s) lack verifiable source evidence: ${missingEvidence.slice(0,3).map((requirement) => requirement.requirementKey).join(", ")}. Restore authoritative document or listing provenance; checking off the compliance matrix cannot bypass this block.`
      : null,
    workspace.sourceRequirements?.completenessStatus !== "complete" && !missingEvidence.length
      ? `Solicitation understanding is incomplete (${workspace.sourceRequirements?.incompleteReasons.join(", ") || "not available"}). Review missing source inputs before drafting.`
      : null,
    workspace.sourceRequirements?.isStale
      ? "Saved solicitation understanding is stale; explicitly review current sources before any new model regeneration."
      : null,
  ].filter((reason): reason is string => Boolean(reason));

  const reconciliationBlockers = [
    snapshot.snapshotStatus !== "complete" || snapshot.documents.some((document) => document.status !== "stored")
      ? "The current source package has unretained original documents." : null,
    !workspace.sourceRequirements
      ? "No completed solicitation understanding is available." : null,
    workspace.sourceRequirements?.isStale
      ? "The latest understanding is still stale. Review any newly changed original files before a manual refresh." : null,
    missingEvidence.length
      ? `${missingEvidence.length} requirement(s) lack verifiable evidence: ${missingEvidence.slice(0,5).map((requirement) =>
          `${requirement.requirementKey} — ${requirement.text}`).join("; ")}. A repeated AI refresh is not a substitute for verified original-source evidence.` : null,
    workspace.sourceRequirements && workspace.sourceRequirements.completenessStatus !== "complete" && !missingEvidence.length
      ? `The current understanding remains partial: ${workspace.sourceRequirements.incompleteReasons.join(", ") || "source coverage incomplete"}.` : null,
  ].filter((reason): reason is string => Boolean(reason));

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
          <Section id="prepare-bid" title="Prepare bid" icon={<FileText className="size-5" />}>
            <p className="mb-4 text-sm leading-6 text-[var(--muted-foreground)]">
              First write what your company will supply, then check each buyer request below your saved response.
              Each card shows just your next action. Detailed sources and other options are available when needed.
            </p>
            {/* Preserve deep links from existing guidance and bookmarked bid pages. */}
            <span id="compliance-requirements" className="block scroll-mt-5" />
            <span id="response-sections" className="block scroll-mt-5" />
            <BidOutlineControl
              workspaceId={workspace.id}
              initialSections={workspace.sections}
              groups={builderGroups}
              generations={generations}
              sourceBlockers={sourceBlockers}
              sourceAvailable={Boolean(workspace.sourceRequirements?.requirements.length)}
              sourceReady={
                snapshot.snapshotStatus === "complete" &&
                !snapshot.stale &&
                workspace.sourceRequirements?.completenessStatus === "complete" &&
                !workspace.sourceRequirements.isStale
              }
              context={{
                workspaceId: workspace.id,
                sourceReady: Boolean(snapshot.snapshotStatus === "complete" && !snapshot.stale && sourceEligible),
                snapshotCurrent: Boolean(
                  snapshot.pursuitSnapshotId &&
                  snapshot.snapshotStatus === "complete" &&
                  !snapshot.stale &&
                  snapshot.documentSetFingerprint &&
                  snapshot.documentSetFingerprint === snapshot.currentDocumentSetFingerprint &&
                  snapshot.storedDocumentCount === snapshot.totalDocumentCount &&
                  snapshot.documents.every((document) => document.status === "stored")
                ),
                understandingCurrent: Boolean(sourceEligible),
                sourceReviewAllowed: Boolean(workspace.sourceRequirements && !workspace.sourceRequirements.isStale &&
                  snapshot.snapshotStatus === "complete" && !snapshot.stale),
                documents: snapshot.documents,
                currentSnapshotId: snapshot.pursuitSnapshotId,
                currentUnderstandingId: workspace.sourceRequirements?.understandingId ?? null,
                confirmedOriginalForms: workspace.confirmedOriginalForms,
                sections: workspace.sections.map((section) => ({
                  id: section.id,
                  title: section.title,
                  content: section.content,
                  ready: savedSectionCanAddressRequirement(section, {
                    snapshotId: snapshot.pursuitSnapshotId,
                    fingerprint: snapshot.documentSetFingerprint,
                    understandingId: workspace.sourceRequirements?.understandingId ?? null,
                  }),
                })),
              }}
            />
            <details id="previous-source-requirements" className="mt-5 min-w-0 scroll-mt-5 rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Previous-source requirement history ({builderGroups.historical.length})
              </summary>
              <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                Prior source versions and saved notes are retained for reference, but cannot
                count toward current bid completion or be silently rebound to new buyer requirements.
              </p>
              <div className="mt-3 grid gap-2">
                {builderGroups.historical.map((requirement) => (
                  <article key={requirement.id} id={`compliance-requirement-${requirement.id}`}
                    className="min-w-0 scroll-mt-5 rounded-lg border p-3 text-sm">
                    <p className="break-words font-semibold">{requirement.text}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Previously saved: {requirement.status.replaceAll("_", " ")} · Not current
                    </p>
                    {requirement.responseNotes ? (
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs">Saved notes: {requirement.responseNotes}</p>
                    ) : null}
                    <Link href={`/bids/${workspace.id}/evidence/${requirement.id}`}
                      className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2">
                      View historical source evidence (read-only)
                    </Link>
                  </article>
                ))}
                {!builderGroups.historical.length ? <p className="text-xs">No previous-source requirement rows.</p> : null}
              </div>
            </details>
          </Section>

          <details id="source-documents-and-technical-details"
            open={snapshot.stale || snapshot.snapshotStatus !== "complete"}
            className="min-w-0 scroll-mt-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">
              Source documents and technical details
            </summary>
            <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
              Use this area when a buyer requirement asks for missing originals or when you need
              to inspect the detailed progress report. Your work in the bid builder stays saved.
            </p>
            <div className="mt-4 grid min-w-0 gap-5">
          <GuidedBidProgress workspace={workspace} />
          <BidWorkspaceControl
            workspaceId={workspace.id}
            initialStatus={workspace.status}
            initialReviewState={workspace.reviewState}
            initialNotes={workspace.notes}
          />

          <Section id="source-snapshot" title="Source snapshot" icon={<ShieldCheck className="size-5" />}>
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
                      id={`source-document-${document.id}`}
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
            {snapshot.documents.some((document) => document.status !== "stored") ? (
              <BidSourceRefreshAction workspaceId={workspace.id} unavailableCount={snapshot.documents.filter((document) => document.status !== "stored").length} />
            ) : null}
            {showSourceReconciliation ? (
              <BidSourceReconciliationAction
                key={snapshot.pursuitSnapshotId ?? "no-snapshot"}
                workspaceId={workspace.id}
                opportunityId={workspace.opportunityId}
                documents={snapshot.documents.map((document) => ({
                  id:document.id,
                  versionId:document.opportunityDocumentVersionId,
                  filename:document.filename,
                  status:document.status,
                  changed:!previousVersionIds.has(document.opportunityDocumentVersionId),
                }))}
                blockingReasons={reconciliationBlockers}
                requiresUnderstanding={Boolean(workspace.sourceRequirements?.isStale ||
                  workspace.sourceRequirements?.completenessStatus !== "complete")}
                canReconcile={reconciliationBlockers.length === 0}
              />
            ) : null}
          </Section>

          <Section id="source-requirements" title="Source requirements" icon={<ClipboardCheck className="size-5" />}>
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

            </div>
          </details>

          <Section id="final-review" title="Final review and external submission" icon={<ClipboardCheck className="size-5" />}>
            <BidFinalReview
              workspaceId={workspace.id}
              opportunityId={workspace.opportunityId}
              review={workspace.finalReview}
              confirmedOriginalForms={workspace.confirmedOriginalForms}
              approvalCurrent={workspace.finalReviewApprovalCurrent}
            />
          </Section>
        </div>
      </div>
    </main>
  );
}
