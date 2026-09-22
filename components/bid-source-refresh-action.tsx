"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** Explicit, bounded original-file recovery, independent of paid AI drafting. */
export function BidSourceRefreshAction({workspaceId,unavailableCount}:{
  workspaceId:string;unavailableCount:number;
}) {
  const router=useRouter();
  const inFlight=useRef(false);
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  async function refreshSource() {
    if (inFlight.current) return;
    inFlight.current=true;
    setPending(true);
    setMessage(null);
    try {
      const response=await fetch(`/api/bids/${workspaceId}/source-snapshot`,{
        method:"POST",
      });
      const result=await response.json() as {
        error?:{message:string};
        snapshot?:{state:string;stored:number;total:number;blocked:number;failed:number};
      };
      if (!response.ok) {
        setMessage(result.error?.message ?? "Original source files could not be retrieved.");
      } else if (result.snapshot?.state==="complete") {
        setMessage(`All ${result.snapshot.stored} original source files retained. Review the current source requirements and refresh the workspace.`);
      } else {
        setMessage(`Source retention is ${result.snapshot?.state ?? "incomplete"}: ${result.snapshot?.stored ?? 0}/${result.snapshot?.total ?? 0} stored; ${result.snapshot?.blocked ?? 0} blocked; ${result.snapshot?.failed ?? 0} failed. Check source access and the original documents.`);
      }
      router.refresh();
    } catch {
      setMessage("Source retrieval did not complete. Check the source connection and use the bounded snapshot batch for large files.");
    } finally {
      inFlight.current=false;
      setPending(false);
    }
  }

  return <div className="mt-4 grid min-w-0 gap-2">
    <button type="button" disabled={pending || unavailableCount===0} onClick={refreshSource}
      className="w-fit max-w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
      {pending ? "Retrieving original source files…" : "Retrieve source files"}
    </button>
    <p className="break-words text-xs leading-5 text-[var(--muted-foreground)]">
      Explicit source retrieval only; no AI call or bid regeneration. Small Beacon packages (up to 5 files, 10 MB per file, 20 MB total) are eligible. Large or access-restricted packages require the bounded source-snapshot batch.
    </p>
    {message ? <p role="status" className="break-words text-xs leading-5">{message}</p> : null}
  </div>;
}
