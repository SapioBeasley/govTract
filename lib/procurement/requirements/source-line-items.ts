import {createHash} from "node:crypto";

import type {PersistedSolicitationRequirement} from "./persistence";

type Input = {
  understandingId:string;sourceRecordId:string;payloadHash:string;
  sourceRevisionId:string|null;source:string;sourceOpportunityId:string;
  rawPayload:Record<string,unknown>;
};
function object(value:unknown):Record<string,unknown>|null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
function nonempty(value:unknown,max:number) {
  return typeof value==="string" && value.trim() && value.trim().length<=max ? value.trim():null;
}
function stableUuid(value:string) {
  const bytes=createHash("sha256").update(value).digest();
  bytes[6]=(bytes[6]! & 15)|64;
  bytes[8]=(bytes[8]! & 63)|128;
  const hex=bytes.subarray(0,16).toString("hex");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join("-");
}
/**
 * Deterministically represent the authoritative structured response line items
 * as requirements; generic uploaded attachments alone do not describe requested
 * line item quantities. The source is raw and immutable to its record hash.
 * This does not modify the saved AI understanding or trigger any model call.
 */
export function deriveBeaconSourceLineItems(input:Input):PersistedSolicitationRequirement[] {
  if (input.source!=="beacon" || !/^[a-f0-9]{64}$/i.test(input.payloadHash) ||
    input.rawPayload.id!==input.sourceOpportunityId) return [];
  const forms=object(input.rawPayload.ebid)?.eforms;
  if(!Array.isArray(forms))return [];
  const seen=new Set<string>();
  return forms.flatMap((entry) => {
    const form=object(entry);
    if(!form || form.type!=="lineitems_form" || !Array.isArray(form.lineItems))return [];
    const formId=nonempty(form.id,128);
    if(!formId)return [];
    return form.lineItems.flatMap((rawItem) => {
      const item=object(rawItem);
      if(!item)return [];
      const id=nonempty(item.id,128),name=nonempty(item.name,500);
      const quantity=nonempty(item.quantity,30),unit=nonempty(item.quantityType,80);
      const notes=nonempty(item.notes,1200);
      if(!id || !name || !quantity || !/^\d+(?:\.\d{1,3})?$/.test(quantity) ||
        Number(quantity)<=0 || !unit)return [];
      const key="ebid.lineItems:"+formId+":"+id;
      if(seen.has(key))return [];
      seen.add(key);
      const excerpt="Line item: "+name+"; quantity: "+quantity+" "+unit+
        (notes ? "; instructions: "+notes : "");
      const text="Supply "+quantity+" "+unit+(Number(quantity)===1?"":"s")+" of "+name+
        (notes?"; "+notes:"")+".";
      return [{
        id:stableUuid(input.understandingId+":"+key),
        requirementKey:key,type:"deliverable",level:"required",
        text,sourceSection:"deliverables",sourceFindingKey:key,
        details:{source:"ebid.lineItems",sourceRecordId:input.sourceRecordId,
          formId,lineItemId:id,quantity,quantityType:unit,
          appliesToResponseSections:["Technical response","Pricing response"]},
        evidence:[],
        listingEvidence:{sourceRecordId:input.sourceRecordId,
          payloadHash:input.payloadHash,sourceRevisionId:input.sourceRevisionId,
          field:"ebid.lineItems" as const,excerpt},
      }];
    });
  });
}
