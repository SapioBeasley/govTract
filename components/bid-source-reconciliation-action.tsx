"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Document = { id:string; versionId:string; filename:string; status:string; changed:boolean };
/** Two independent, explicitly user-triggered actions: paid understanding regeneration
 * and a deterministic, checksum-pinned outline rebind that does not call the model. */
export function BidSourceReconciliationAction({
  workspaceId,opportunityId,documents,requiresUnderstanding,canReconcile,
}:{
  workspaceId:string;opportunityId:string;documents:Document[];
  requiresUnderstanding:boolean;canReconcile:boolean;
}) {
  const router=useRouter();
  const inFlight=useRef(false);
  const [reviewed,setReviewed]=useState<string[]>([]);
  const [pending,setPending]=useState<"understanding"|"reconcile"|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const allReviewed=reviewed.length===documents.length &&
    documents.every((document)=>reviewed.includes(document.versionId));

  async function perform(kind:"understanding"|"reconcile") {
    if (inFlight.current) return;
    if (kind==="reconcile" && (!allReviewed || !canReconcile)) return;
    if (kind==="understanding" && !window.confirm(
      "Manually regenerate solicitation understanding from the current source documents? This may incur a paid AI charge. Previous understanding, bid text, and source snapshots will remain in history."
    )) return;
    if (kind==="reconcile" && !window.confirm(
      "I have inspected every listed original document and saved any unsaved section edits. Rebind the existing bid outline to the newly verified sources? Saved response text will remain but must be reviewed again."
    )) return;
    inFlight.current=true;
    setPending(kind);
    setMessage(null);
    try {
      const response=await fetch(kind==="understanding"
        ? `/api/opportunities/${opportunityId}/understanding`
        : `/api/bids/${workspaceId}/source-reconciliation`,{
        method:"POST",
        ...(kind==="reconcile"?{
          headers:{"content-type":"application/json"},
          body:JSON.stringify({reviewedDocumentVersionIds:reviewed}),
        }:{}),
      });
      const body=await response.json() as {error?:{message?:string};result?:{state?:string}};
      if (!response.ok) {
        setMessage(body.error?.message??"Source review was not completed; no existing bid response was overwritten.");
      } else {
        setMessage(kind==="understanding"
          ? "Manual understanding request completed. Review its evidence, then reconcile the bid against all current source files."
          : "Source snapshot and outline reconciled without regenerating the bid response. Recheck all preserved answers, forms and compliance items.");
        router.refresh();
      }
    } catch {
      setMessage("Source review could not complete. Check the existing bid and source documents before retrying.");
    } finally {
      inFlight.current=false;
      setPending(null);
    }
  }

  return <div className="mt-4 grid min-w-0 gap-3 rounded-lg border p-4">
    <p className="text-sm font-semibold">Review the current original source package</p>
    <p className="text-xs leading-5 text-[var(--muted-foreground)]">
      A newer source document or stale understanding blocks drafting. Review each original document and any new signature form or amendment before rebinding the saved bid. Previously saved response text is preserved. No understanding or bid draft is regenerated on page load.
    </p>
    <div className="grid gap-2">
      {documents.map((document)=>(
        <label className="flex min-w-0 items-start gap-2 text-xs" key={document.versionId}>
          <input type="checkbox" className="mt-0.5" checked={reviewed.includes(document.versionId)}
            onChange={(event)=>setReviewed((before)=>event.target.checked
              ? [...before,document.versionId] : before.filter((id)=>id!==document.versionId))} />
          <span className="min-w-0 break-words">
            {document.changed?"New or changed: ":""}{document.filename} · {document.status}
          </span>
        </label>
      ))}
    </div>
    {requiresUnderstanding ? (
      <button type="button" onClick={()=>perform("understanding")} disabled={pending!==null ||
        documents.some((document)=>document.status!=="stored")}
        className="w-fit rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">
        {pending==="understanding"?"Regenerating manually…":"Manually refresh understanding with AI (may incur cost)"}
      </button>
    ):null}
    <button type="button" onClick={()=>perform("reconcile")} disabled={!canReconcile || !allReviewed || pending!==null}
      className="w-fit rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">
      {pending==="reconcile"?"Reconciling source and outline…":"Reconcile reviewed source and outline (no AI call)"}
    </button>
    {!canReconcile?<p role="status" className="text-xs leading-5">
      Reconciliation requires a complete, current understanding with verified evidence from every original source file.
      If the AI refresh cannot produce that evidence, drafting stays disabled; missing excerpts are never invented.
    </p>:null}
    {message?<p role="status" className="text-xs leading-5">{message}</p>:null}
  </div>;
}
