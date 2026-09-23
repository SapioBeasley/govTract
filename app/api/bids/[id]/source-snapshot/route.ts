import { NextResponse } from "next/server";

import { refreshBidSourceSnapshot } from "@/lib/procurement/pursuits/manual-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** User-triggered retrieval only; opening a workspace does not start a download or an AI call. */
export async function POST(_request: Request, context:{params:Promise<{id:string}>}) {
  const {id} = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({error:{message:"Bid workspace id is invalid."}},{status:400});
  }
  try {
    const result = await refreshBidSourceSnapshot(id);
    if (result.state !== "complete") {
      const code = result.blocked ? "source_storage_or_access_blocked" :
        result.failed ? "source_retrieval_failed" : "source_retrieval_incomplete";
      return NextResponse.json({snapshot:result,error:{
        code,
        message:result.blocked
          ? "At least one original source file could not be stored. Check the private Blob store connection and retry retrieval; AI drafting remains blocked."
          : "One or more original source files were not reliably retained. Review the source access and retry; AI drafting remains blocked.",
      }},{status:503});
    }
    return NextResponse.json({snapshot:result});
  } catch (error) {
    const message = error instanceof Error ? error.message : "The original source package could not be retrieved.";
    // Do not expose source-session, Blob or raw provider errors in the browser.
    if (/Bid workspace was not found/.test(message)) {
      return NextResponse.json({error:{message:"Bid workspace was not found."}},{status:404});
    }
    if (/On-demand source retention|solicitation package exceeds|No complete authoritative/.test(message)) {
      return NextResponse.json({error:{message}},{status:409});
    }
    return NextResponse.json({error:{message:"Original source retrieval failed. Check the source connection and the bounded source-snapshot job; your bid and AI understanding were not changed."}},{status:503});
  }
}
