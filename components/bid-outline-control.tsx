"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { BidWorkspaceRequirement, BidWorkspaceSection } from "@/lib/bids/workspace";

function SectionEditor({
  workspaceId,
  section,
  requirements,
  onMove,
  first,
  last,
}: {
  workspaceId: string;
  section: BidWorkspaceSection;
  requirements: BidWorkspaceRequirement[];
  onMove: (id: string, offset: number) => Promise<void>;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(section.title);
  const [instructions, setInstructions] = useState(section.instructions ?? "");
  const [content, setContent] = useState(section.content ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setTitle(section.title);
    setInstructions(section.instructions ?? "");
    setContent(section.content ?? "");
  }, [section.title, section.instructions, section.content]);

  const changed =
    title !== section.title ||
    instructions !== (section.instructions ?? "") ||
    content !== (section.content ?? "");
  const sourceKeys = Array.isArray(section.requirementLinks.sourceRequirementKeys)
    ? section.requirementLinks.sourceRequirementKeys.filter((key): key is string => typeof key === "string")
    : [];
  const warnings = [
    section.metadata.snapshotStale === true ? "Source documents changed since creation." : null,
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
        body: JSON.stringify({ title, instructions: instructions.trim() || null, content }),
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
    <article className="grid min-w-0 gap-3 rounded-xl border p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--muted-foreground)]">
          {section.metadata.source === "solicitation_heading"
            ? "Solicitation heading"
            : "Suggested grouping — verify against solicitation"}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onMove(section.id, -1)} disabled={first || pending}
            className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
            aria-label={`Move ${section.title} up`}>Move up</button>
          <button type="button" onClick={() => onMove(section.id, 1)} disabled={last || pending}
            className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
            aria-label={`Move ${section.title} down`}>Move down</button>
        </div>
      </div>
      {warnings.length ? (
        <p className="rounded-lg border p-2 text-xs leading-5 text-[var(--muted-foreground)]" role="status">
          {warnings.join(" ")} Review the authoritative documents before treating this outline as current.
        </p>
      ) : null}
      <label className="grid min-w-0 gap-1 text-xs font-medium">
        Response section heading
        <input value={title} onChange={(event) => setTitle(event.target.value)}
          maxLength={200} className="h-10 min-w-0 rounded-lg border bg-white px-3 text-sm" />
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">
        Source instructions and formatting (editable)
        <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)}
          maxLength={20_000} rows={3}
          className="min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm" />
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">
        Draft response
        <textarea value={content} onChange={(event) => setContent(event.target.value)}
          maxLength={200_000} rows={4} placeholder="Write or paste your response here…"
          className="min-w-0 resize-y rounded-lg border bg-white px-3 py-2 text-sm" />
      </label>
      <div className="flex min-w-0 flex-wrap gap-1 text-xs text-[var(--muted-foreground)]">
        <span className="mr-1">Linked requirements:</span>
        {sourceKeys.length ? sourceKeys.map((key) => {
          const row = requirements.find((requirement) => requirement.sourceRequirementKey === key);
          return row ? (
            <Link key={key} href={`/bids/${workspaceId}/evidence/${row.id}`}
              className="max-w-full break-all rounded-full border px-2 py-0.5 underline underline-offset-2">
              {key}
            </Link>
          ) : (
            <span key={key} className="max-w-full break-all rounded-full border px-2 py-0.5">{key}</span>
          );
        }) : <span>No requirement links; review before drafting.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={!changed || pending || !title.trim()}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {pending ? "Saving…" : "Save section"}
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          {section.wordCount} saved words
        </span>
        {message ? <span role="status" className="break-words text-xs">{message}</span> : null}
      </div>
    </article>
  );
}

export function BidOutlineControl({
  workspaceId,
  initialSections,
  requirements,
  sourceAvailable,
  sourceReady,
}: {
  workspaceId: string;
  initialSections: BidWorkspaceSection[];
  requirements: BidWorkspaceRequirement[];
  sourceAvailable: boolean;
  sourceReady: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSections(initialSections), [initialSections]);

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
        Build the response structure from persisted solicitation requirements. Explicit source headings
        take priority; suggested groupings require your review. No AI calls are made to create or edit this outline.
      </p>
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
          {sections.map((section, index) => (
            <SectionEditor key={section.id} workspaceId={workspaceId} section={section}
              requirements={requirements} onMove={move} first={index === 0 || pending}
              last={index === sections.length - 1 || pending} />
          ))}
        </>
      )}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
