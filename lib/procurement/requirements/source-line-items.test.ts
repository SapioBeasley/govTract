import assert from "node:assert/strict";
import test from "node:test";

import {deriveBeaconSourceLineItems} from "./source-line-items";

test("authoritative Beacon eBid line items keep purchase quantity distinct from per-case packaging without an AI call",()=>{
  const input={understandingId:"00000000-0000-4000-8000-000000000100",sourceRecordId:"source-1",
    payloadHash:"a".repeat(64),sourceRevisionId:"rev-1",source:"beacon",sourceOpportunityId:"opp-1",
    rawPayload:{id:"opp-1",ebid:{eforms:[{type:"lineitems_form",id:"form-1",
      lineItems:[{id:"item-1",name:"GREEN DIAMOND PAD, CASE OF 4 PADS",quantity:"105",
        quantityType:"case",notes:"Please provide freight cost included in unit price."}]}]}}};
  const [item]=deriveBeaconSourceLineItems(input);
  assert.ok(item);
  assert.equal(item.type,"deliverable");
  assert.equal(item.level,"required");
  assert.match(item.text,/105 cases? of GREEN DIAMOND PAD, CASE OF 4 PADS/i);
  assert.match(item.text,/freight cost included in unit price/i);
  assert.equal(item.listingEvidence?.field,"ebid.lineItems");
  assert.equal(item.listingEvidence?.sourceRecordId,"source-1");
  assert.equal(item.listingEvidence?.payloadHash,"a".repeat(64));
  assert.equal(item.evidence.length,0);
  assert.deepEqual(deriveBeaconSourceLineItems(input),[item],"derived IDs and source citations must be stable");
  assert.equal(deriveBeaconSourceLineItems({...input,sourceOpportunityId:"other"}).length,0);
  assert.equal(deriveBeaconSourceLineItems({...input,source:"sam"}).length,0);
  assert.equal(deriveBeaconSourceLineItems({...input,payloadHash:"no-hash"}).length,0);
});
