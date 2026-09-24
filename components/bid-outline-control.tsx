"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { BidWorkspaceRequirement, BidWorkspaceSection } from "@/lib/bids/workspace";
import type { BidDraftGenerationSummary } from "@/lib/bids/draft-persistence";
import { BidDraftAction } from "@/components/bid-draft-action";
import { ComplianceRow } from "@/components/compliance-matrix-control";
import type { ComplianceGuidanceContext } from "@/lib/bids/compliance-guidance";
import type { BidBuilderGroups } from "@/lib/bids/builder";

function SectionEditor({
  workspaceId,
  section,
  linkedRequirements,
  context,
  onMove,
  first,
  last,
  sourceReady,
  sourceBlockers,
  generations,
}: {
  workspaceId: string;
  section: BidWorkspaceSection;
  linkedRequirements: BidWorkspaceRequirement[];
  context: ComplianceGuidanceContext;
  onMove: (id: string, offset: number) => Promise<void>;
  first: boolean;
  last: boolean;
  sourceReady: boolean;
  sourceBlockers: string[];
  generations: BidDraftGenerationSummary[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(section.title);
  const [instructions, setInstructions] = useState(section.instructions ?? "");
  const [content, setContent] = useState(section.content ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [verifyVendorFacts, setVerifyVendorFacts] = useState(false);
  const [reviewedCurrentSource, setReviewedCurrentSource] = useState(false);
  useEffect(() => {
    setVerifyVendorFacts(false);
    setReviewedCurrentSource(false);
    setTitle(section.title);
    setInstructions(section.instructions ?? "");
    setContent(section.content ?? "");
  }, [section.title, section.instructions, section.content, section.metadata.sourceReviewRequired]);

  const changed =
    title !== section.title ||
    instructions !== (section.instructions ?? "") ||
    content !== (section.content ?? "");
  const aiReview = section.metadata.aiDraftReview && typeof section.metadata.aiDraftReview === "object"
    ? section.metadata.aiDraftReview as { claims?: unknown; modelIssues?: unknown } : null;
  const aiWarnings = [aiReview?.claims, aiReview?.modelIssues].flatMap((items) =>
    Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []);
  const warnings = [
    section.metadata.snapshotStale === true ? "Source documents changed since creation." : null,
    section.metadata.sourceReviewRequired === true ? "Preserved section text or instructions require explicit review against the current original files." : null,
    section.metadata.understandingStale === true ? "Source understanding was stale at creation." : null,
    section.metadata.completenessStatus === "partial" ? "Source requirements were incomplete at creation." : null,
    section.metadata.snapshotStatus !== "complete" ? "Source snapshot was not complete at creation." : null,
  ].filter(Boolean);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/outline/${section.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, instructions: instructions.trim() || null, content,
          ...(verifyVendorFacts ? { verifiedVendorFacts: true } : {}),
          ...(reviewedCurrentSource ? { reviewedCurrentSource: true } : {}) }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Response section could not be saved.");
      } else {
        setMessage("Section saved.");
        router.refresh();
      }
    } catch {
      setMessage("Response section could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="grid min-w-0 gap-3 border-t p-4 sm:p-5">
      <h4 className="text-base font-semibold">Step 1: Write your response</h4>
      <p className="text-xs leading-5 text-[var(--muted-foreground)]">
        Describe what you will actually supply and how you meet the buyer's instructions.
        Do not treat a copied buyer requirement as evidence of your offer.
      </p>
      {warnings.length ? (
        <p className="rounded-lg border p-2 text-xs leading-5 text-[var(--muted-foreground)]" role="status">
          {warnings.join(" ")} Review the authoritative documents before treating this outline as current.
        </p>
      ) : null}
      <details className="min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-xs font-semibold">Edit heading and source instructions</summary>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {section.metadata.source === "solicitation_heading"
            ? "This heading comes from the solicitation."
            : "Suggested heading—edit to match the solicitation."}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap gap-2">
          <button type="button" onClick={() => onMove(section.id, -1)} disabled={first || pending}
            className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
            aria-label={"Move " + section.title + " up"}>Move up</button>
          <button type="button" onClick={() => onMove(section.id, 1)} disabled={last || pending}
            className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
            aria-label={"Move " + section.title + " down"}>Move down</button>
        </div>
        <label className="mt-3 grid min-w-0 gap-1 text-xs font-medium">
          Response section heading
          <input value={title} onChange={(event) => setTitle(event.target.value)}
            maxLength={200} className="h-10 min-w-0 rounded-lg border bg-white px-3 text-sm" />
        </label>
        <label className="mt-3 grid min-w-0 gap-1 text-xs font-medium">
          Source instructions and formatting (editable)
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)}
            maxLength={20_000} rows={3}
            className="min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm" />
        </label>
      </details>
      <label className="grid min-w-0 gap-1 text-xs font-medium">
        Draft response
        <textarea value={content} onChange={(event) => setContent(event.target.value)}
          maxLength={200_000} rows={4} placeholder="Write or paste your response here…"
          className="min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm" />
      </label>
      {aiReview ? (
        <div role="alert" className="grid min-w-0 gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <p className="font-semibold">Unverified AI bid draft — not approved for final review.</p>
          <p>Compare every offered make/model, rating, test weight, product certification, manufacturer test result,
            delivery plan, warranty, pricing, staffing and insurance statement with actual company/manufacturer evidence.
            The solicitation tells you what the buyer requested; it does not establish what your company can supply.
            Correct unverified statements and remove all NEEDS INPUT placeholders before verifying this exact response.</p>
          {aiWarnings.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {aiWarnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}
            </ul>
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={verifyVendorFacts}
              onChange={(event) => setVerifyVendorFacts(event.target.checked)}
              disabled={pending || !sourceReady} />
            I checked the offered models and their distinct capacities/test weights and verified all company,
            manufacturer, testing, certification, delivery, warranty, pricing and insurance commitments
            in this saved text against actual evidence. I resolved every missing-fact question.
          </label>
          {typeof section.metadata.verifiedVendorFactsFingerprint === "string"
            ? <p>Fact verification was recorded for a saved draft. Final review rechecks the exact text and source package.</p>
            : <p>Final review remains blocked until you explicitly verify and save the corrected draft.</p>}
        </div>
      ) : null}
      {section.metadata.sourceReviewRequired === true ? (
        <label className="flex items-start gap-2 rounded-lg border p-3 text-xs leading-5">
          <input type="checkbox" className="mt-1" checked={reviewedCurrentSource}
            disabled={!sourceReady || pending}
            onChange={(event) => setReviewedCurrentSource(event.target.checked)} />
          I inspected the current original documents and reviewed this preserved section wording,
          its mandatory requirements, formatting and response against the updated source package.
          Keep the saved text, but require a new vendor-fact approval for any prior AI draft.
        </label>
      ) : null}
      <details className="min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-xs font-semibold">
          Optional: Draft with AI (manual action)
        </summary>
        <p className="mt-2 text-xs leading-5">
          AI can help write a draft but cannot verify your product or company claims. Review all
          generated text before you save or confirm it; generating a draft is not required to bid.
        </p>
        <BidDraftAction
          workspaceId={workspaceId}
          sectionId={section.id}
          currentContent={section.content}
          unsavedChanges={changed}
          sourceReady={sourceReady && section.metadata.sourceReviewRequired !== true}
          sourceBlockers={section.metadata.sourceReviewRequired === true
            ? [...sourceBlockers, "Review and save the preserved response against the current original documents before drafting."]
            : sourceBlockers}
          generations={generations}
        />
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={(!changed && !verifyVendorFacts && !reviewedCurrentSource) || pending || !title.trim()}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {pending ? "Saving…" : "Save section"}
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          {section.wordCount} saved words
        </span>
        {message ? <span role="status" className="break-words text-xs">{message}</span> : null}
      </div>
      <div className="grid min-w-0 gap-3 border-t pt-4" aria-label={`Buyer requirements linked to ${section.title}`}>
        <h4 className="text-base font-semibold">Step 2: Check what the buyer asked for ({linkedRequirements.length})</h4>
        <p className="text-xs leading-5 text-[var(--muted-foreground)]">
          Each buyer request has one next action. Save your response above, then confirm only those
          requests that your actual offer addresses. You do not need to select the heading again.
        </p>
        {changed ? <p role="status" className="rounded-lg border p-3 text-xs">
          Save your response edits above before checking these requirements.
        </p> : null}
        {linkedRequirements.length ? linkedRequirements.map((requirement) => (
          <ComplianceRow key={requirement.id} requirement={requirement}
            context={{ ...context, sections: context.sections.filter((choice) => choice.id === section.id)
              .map((choice) => ({ ...choice, ready: choice.ready && !changed })) }} />
        )) : (
          <p className="rounded-lg border border-dashed p-3 text-xs leading-5">
            No current buyer requirements are linked to this heading. Verify the original solicitation
            and check Submission & source checks for unmatched items.
          </p>
        )}
      </div>
    </article>
  );
}

export function BidOutlineControl({
  workspaceId,
  initialSections,
  groups,
  context,
  sourceAvailable,
  sourceReady,
  sourceBlockers,
  generations,
}: {
  workspaceId: string;
  initialSections: BidWorkspaceSection[];
  groups: BidBuilderGroups;
  context: ComplianceGuidanceContext;
  sourceAvailable: boolean;
  sourceReady: boolean;
  sourceBlockers: string[];
  generations: BidDraftGenerationSummary[];
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSections(initialSections), [initialSections]);
  useEffect(() => {
    const openLinkedSection = () => {
      const id = decodeURIComponent(window.location.hash.slice(1).split("#")[0] ?? "");
      const target = id ? document.getElementById(id) : null;
      const details = target?.closest("details");
      if (details) {
        details.open = true;
        let parent = details.parentElement?.closest("details") ?? null;
        while (parent) {
          parent.open = true;
          parent = parent.parentElement?.closest("details") ?? null;
        }
        target?.scrollIntoView({ block: "start" });
      }
    };
    openLinkedSection();
    window.addEventListener("hashchange", openLinkedSection);
    return () => window.removeEventListener("hashchange", openLinkedSection);
  }, []);

  async function refreshRequirements() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/compliance`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Buyer requirements could not be updated.");
      else router.refresh();
    } catch {
      setMessage("Buyer requirements could not be updated; your saved work was preserved.");
    } finally {
      setPending(false);
    }
  }

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/outline`, { method: "POST" });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Outline could not be prepared.");
      else router.refresh();
    } catch {
      setMessage("Outline could not be prepared.");
    } finally {
      setPending(false);
    }
  }

  async function move(id: string, offset: number) {
    const start = sections.findIndex((section) => section.id === id);
    const target = start + offset;
    if (start < 0 || target < 0 || target >= sections.length || pending) return;
    const reordered = [...sections];
    [reordered[start], reordered[target]] = [reordered[target]!, reordered[start]!];
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bids/${workspaceId}/outline/order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionIds: reordered.map((section) => section.id) }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) setMessage(payload.error?.message ?? "Section order could not be saved.");
      else {
        setSections(reordered);
        router.refresh();
      }
    } catch {
      setMessage("Section order could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        Prepare each section of your bid, then review the buyer requirements shown directly beneath
        the matching saved response. Solicitation-prescribed headings are identified; other headings
        are suggestions to verify and edit. Preparing headings or checking requirements does not invoke AI.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted-foreground)]">{groups.current.length} current buyer requirements · {groups.historical.length} from previous source versions</p>
        <button type="button" onClick={refreshRequirements} disabled={pending || !sourceAvailable}
          className="min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">
          {pending ? "Updating…" : groups.current.length ? "Add newly extracted requirements" : "Build buyer requirements"}
        </button>
      </div>
      {!sourceReady ? (
        <p className="rounded-xl border p-3 text-xs leading-5">
          Source evidence is incomplete or has changed. You may prepare an outline, but review current
          solicitation documents, required sections, formatting and page limits before submission.
        </p>
      ) : null}
      {!sections.length ? (
        <div className="grid gap-3 rounded-xl border border-dashed p-4 text-sm">
          <p>{sourceAvailable
            ? "No response outline exists yet. Generate one from the saved solicitation requirements."
            : "No structured requirements are available. Finish solicitation understanding before creating an outline."}</p>
          <button type="button" onClick={generate} disabled={!sourceAvailable || pending}
            className="w-fit rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
            {pending ? "Preparing…" : "Generate bid outline"}
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--muted-foreground)]">
            {sections.length} saved response section{sections.length === 1 ? "" : "s"}.
            Editing or reopening will not regenerate or overwrite the outline.
          </p>
          <nav aria-label="Bid response headings" className="flex min-w-0 flex-wrap gap-2">
            {sections.map((section) => (
              <a key={section.id} href={`#response-section-${section.id}`}
                className="inline-flex min-h-11 max-w-full items-center rounded-lg border px-3 py-2 text-xs font-semibold underline underline-offset-2 [overflow-wrap:anywhere]">
                {section.title}
              </a>
            ))}
            <a href="#submission-source-checks"
              className="inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-semibold underline underline-offset-2">
              Submission & source checks
            </a>
          </nav>
          {sections.map((section, index) => {
            const rows = groups.bySection[section.id] ?? [];
            return (
              <details key={section.id} id={`response-section-${section.id}`}
                open={index === 0} className="min-w-0 scroll-mt-5 overflow-hidden rounded-xl border">
                <summary className="cursor-pointer p-4 text-sm font-semibold sm:p-5">
                  <span className="block break-words">{section.title}</span>
                  <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">
                    {section.metadata.source === "solicitation_heading" ? "Solicitation heading" :
                      "Suggested heading—edit to match the solicitation"} ·
                    {" "}{rows.length} linked buyer requirements ·
                    {" "}{rows.filter((row) => row.effectiveStatus === "complete").length} reviewed as addressed ·
                    {" "}{rows.filter((row) => !row.canMarkComplete).length} need source resolution
                  </span>
                </summary>
                <SectionEditor workspaceId={workspaceId} section={section}
                  linkedRequirements={rows} context={context} onMove={move}
                  first={index === 0 || pending} last={index === sections.length - 1 || pending}
                  sourceReady={sourceReady} sourceBlockers={sourceBlockers} generations={generations} />
              </details>
            );
          })}
        </>
      )}
      <details id="submission-source-checks" className="min-w-0 scroll-mt-5 rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Submission & source checks ({groups.unassigned.length})
        </summary>
        <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
          These current buyer requirements do not have a mapped prose response, or concern
          submission, mandatory events, deadlines or other non-writing obligations.
          They are never silently counted as addressed by a generic response heading.
          Source findings still require independent verification.
        </p>
        <div className="mt-3 grid gap-3">
          {groups.unassigned.map((requirement) => (
            <ComplianceRow key={requirement.id} requirement={requirement}
              context={{ ...context, sections: [] }} />
          ))}
          {!groups.unassigned.length ? <p className="text-xs">No unassigned checks.</p> : null}
        </div>
      </details>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
