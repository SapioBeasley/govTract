import { NextResponse } from "next/server";

import { reconcileBidSource } from "@/lib/bids/source-reconciliation-persistence";

export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit human-reviewed source rebind, never a paid understanding or bid-drafting call. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  if (!UUID.test(id)) return NextResponse.json({error:{message:"Invalid bid workspace id."}},{status:400});
  let input:unknown;
  try{input=await request.json();}catch{return NextResponse.json({error:{message:"Expected source review confirmation."}},{status:400});}
  const body=input && typeof input==="object" && !Array.isArray(input)
    ? input as Record<string,unknown> : {};
  const ids=body.reviewedDocumentVersionIds;
  if (!Array.isArray(ids) || !ids.length || ids.length>100 ||
    ids.some((value)=>typeof value!=="string" || !UUID.test(value)) ||
    new Set(ids).size!==ids.length) {
    return NextResponse.json({error:{message:"Review and explicitly confirm every current original source document."}},{status:400});
  }
  try{
    const workspace=await reconcileBidSource(id,ids as string[]);
    return NextResponse.json({workspace});
  }catch(error){
    const message=error instanceof Error?error.message:"Bid source reconciliation failed.";
    return NextResponse.json({error:{message}},{status:message==="Bid workspace was not found"?404:409});
  }
}
