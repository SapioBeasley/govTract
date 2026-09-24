import Link from "next/link";
import { notFound } from "next/navigation";

import { isComplianceEvidence } from "@/lib/bids/compliance";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { getPursuitSnapshot } from "@/lib/procurement/pursuits/snapshot";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; requirementId: string }> };

export default async function ComplianceEvidencePage({ params }: Props) {
  const { id, requirementId } = await params;
  const workspace = await getBidWorkspace(id);
  if (!workspace) notFound();
  const requirement = workspace.requirements.find((row) => row.id === requirementId);
  if (!requirement || !isComplianceEvidence(requirement.evidence)) notFound();

  const evidence = requirement.evidence;
  const original = isComplianceEvidence(requirement.originalEvidence) ? requirement.originalEvidence : evidence;
  // An older compliance row may predate read-side hydration of its source excerpt.
  // Resolve only against the same immutable understanding and pinned snapshot.
  const currentSourceRequirement =
    workspace.sourceRequirements?.understandingId === evidence.understandingId &&
    workspace.sourceSnapshot.pursuitSnapshotId === evidence.pursuitSnapshotId &&
    !workspace.sourceSnapshot.stale
      ? workspace.sourceRequirements.requirements.find(
          (source) => source.id === evidence.sourceRequirementId,
        )
      : null;
  const listingEvidence = evidence.listingEvidence && currentSourceRequirement?.listingEvidence &&
    JSON.stringify(evidence.listingEvidence) === JSON.stringify(currentSourceRequirement.listingEvidence)
      ? evidence.listingEvidence : null;
  const historicalSnapshot = evidence.pursuitSnapshotId
    ? await getPursuitSnapshot(evidence.pursuitSnapshotId)
    : null;
  const documentsById = new Map(historicalSnapshot?.documents.map((document) => [document.id, document]) ?? []);

  return (
    <main className="min-w-0 overflow-x-clip px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <Link href={`/bids/${workspace.id}`} className="text-sm font-semibold underline underline-offset-2">
          Back to bid workspace
        </Link>
        <h1 className="mt-4 break-words text-2xl font-semibold">Source evidence</h1>
        <p className="mt-2 break-words text-sm leading-6">{requirement.text}</p>
        <div className="mt-5 rounded-xl border bg-white p-4 text-xs leading-6 text-[var(--muted-foreground)]">
          <p className="break-all">Pursuit snapshot: {evidence.pursuitSnapshotId ?? "Not available"}</p>
          <p className="break-all">Understanding: {evidence.understandingId}</p>
          {workspace.sourceSnapshot.pursuitSnapshotId !== evidence.pursuitSnapshotId ? (
            <p className="mt-2 font-semibold">
              This evidence references an earlier immutable source snapshot; review the newer documents before marking complete.
            </p>
          ) : null}
        </div>
        {original.issues.length ? (
          <p className="mt-4 rounded-xl border p-4 text-sm">
            Original source warnings (preserved): {original.issues.map((issue) => issue.replaceAll("_", " ")).join("; ")}.
          </p>
        ) : null}
        {requirement.sourceReview ? (
          <section className="mt-4 min-w-0 rounded-xl border bg-white p-4 text-sm leading-6">
            <h2 className="font-semibold">Audited reviewer source determination (separate from the AI finding)</h2>
            <p>Requiredness: {requirement.sourceReview.level}. This action does not mark the bid response Complete.</p>
            <p className="break-all">Original version: {requirement.sourceReview.documentVersionId}</p>
            <p className="break-all">Original SHA-256: {requirement.sourceReview.documentChecksum}</p>
            <p className="break-words">Source locator: {JSON.stringify(requirement.sourceReview.locator)}</p>
            <p className="mt-2 whitespace-pre-wrap break-words">Verbatim excerpt: {requirement.sourceReview.excerpt}</p>
            {requirement.sourceReview.reviewerNote ? (
              <p className="mt-2 whitespace-pre-wrap break-words">Reviewer rationale: {requirement.sourceReview.reviewerNote}</p>
            ) : null}
            {requirement.sourceReview.createdAt ? (
              <p className="mt-2 text-xs">Recorded: {new Date(requirement.sourceReview.createdAt).toISOString()}</p>
            ) : null}
            {requirement.canMarkComplete ? <p className="mt-2 font-medium">Current source review verified.</p> :
              <p className="mt-2 font-medium">Historical or invalidated source decision: current bid completion remains blocked.</p>}
          </section>
        ) : null}
        {listingEvidence ? (
          <section className="mt-4 rounded-xl border bg-white p-4 text-sm leading-6">
            <h2 className="font-semibold">Authoritative opportunity listing (not a document citation)</h2>
            <p className="mt-1 break-words">Field: {listingEvidence.field}</p>
            <p className="break-all">Source record: {listingEvidence.sourceRecordId} · Revision: {listingEvidence.sourceRevisionId ?? "Unavailable"}</p>
            <p className="break-all">Raw payload SHA-256: {listingEvidence.payloadHash}</p>
            <p className="mt-2 break-words whitespace-pre-wrap">{listingEvidence.excerpt}</p>
          </section>
        ) : evidence.listingEvidence ? (
          <p role="alert" className="mt-4 rounded-xl border p-4 text-sm">The source listing has changed or cannot be verified. Rebuild and review this compliance row before marking it complete.</p>
        ) : null}
        {evidence.references.length ? (
          <div className="mt-4 grid min-w-0 gap-4">
            {evidence.references.map((reference, index) => {
              const historicalDocument = reference.snapshotDocumentId
                ? documentsById.get(reference.snapshotDocumentId)
                : null;
              const matchesVersion = historicalDocument?.opportunityDocumentVersionId === reference.opportunityDocumentVersionId;
              const hydratedExcerpt =
                matchesVersion &&
                historicalDocument?.status === "stored" &&
                historicalDocument.checksumSha256 === reference.checksumSha256
                  ? currentSourceRequirement?.evidence.find((sourceReference) =>
                      sourceReference.opportunityDocumentVersionId === reference.opportunityDocumentVersionId &&
                      sourceReference.documentExtractionSegmentId === reference.documentExtractionSegmentId
                    )?.excerpt
                  : null;
              const excerpt = reference.excerpt?.trim() ? reference.excerpt : hydratedExcerpt;
              return (
                <section key={`${reference.opportunityDocumentVersionId}-${index}`} className="min-w-0 rounded-xl border bg-white p-4">
                  <h2 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
                    {reference.filename ?? "Unmatched source document"}
                  </h2>
                  <dl className="mt-3 grid min-w-0 gap-2 text-xs leading-5">
                    <div><dt className="font-semibold">Original document version</dt><dd className="break-all">{reference.opportunityDocumentVersionId}</dd></div>
                    <div><dt className="font-semibold">Snapshot document</dt><dd className="break-all">{reference.snapshotDocumentId ?? "Not captured"}</dd></div>
                    <div><dt className="font-semibold">SHA-256</dt><dd className="break-all">{reference.checksumSha256 ?? "Unavailable"}</dd></div>
                    <div><dt className="font-semibold">Historical source state</dt><dd className="break-words">{matchesVersion ? historicalDocument?.status : "Version not matched in pinned snapshot"}</dd></div>
                    <div><dt className="font-semibold">Location</dt><dd className="break-words [overflow-wrap:anywhere]">{JSON.stringify(reference.locator)}</dd></div>
                    {excerpt ? <div><dt className="font-semibold">Extracted evidence</dt><dd className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{excerpt}</dd></div> : null}
                  </dl>
                </section>
              );
            })}
          </div>
        ) : listingEvidence ? null : (
          <p className="mt-4 rounded-xl border border-dashed p-4 text-sm">
            No verifiable document-level evidence was extracted for this requirement.
          </p>
        )}
      </div>
    </main>
  );
}
