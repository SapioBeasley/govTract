import assert from "node:assert/strict";
import test from "node:test";

import { assessBidSourceReconciliation } from "./source-reconciliation";

const doc = (versionId:string, status="stored")=>({
  id:versionId,opportunityDocumentVersionId:versionId,filename:versionId+".pdf",
  status,failureCode:null,checksumSha256:"a".repeat(64),
});
const snapshot = {
  pursuitSnapshotId:"snapshot-new",documentSetFingerprint:"fingerprint-new",
  currentDocumentSetFingerprint:"fingerprint-new",snapshotStatus:"complete" as const,
  stale:true,staleReason:"authoritative_document_set_changed",
  supersedesSnapshotId:"snapshot-old",totalDocumentCount:3,storedDocumentCount:3,
  blockedDocumentCount:0,failedDocumentCount:0,documents:[doc("terms"),doc("specs"),doc("signature")],
};
const source = {
  understandingId:"understanding-new",completenessStatus:"complete" as const,
  isStale:false,incompleteReasons:[],requirements:[
    {requirementKey:"form:signature",listingEvidence:null,evidence:[{
      opportunityDocumentVersionId:"signature",documentExtractionSegmentId:"segment-signature",
      locator:{paragraph:1},excerpt:"The bidder shall complete and sign the official signature page.",
    }]},
    {requirementKey:"scope:specs",listingEvidence:null,evidence:[{
      opportunityDocumentVersionId:"specs",documentExtractionSegmentId:"segment-specs",
      locator:{paragraph:1},excerpt:"The delivered chair shall include an original warranty.",
    }]},
  ],
};

test("adding a required signature page needs an explicitly refreshed, complete understanding covering ALL snapshot versions",()=>{
  const ready=assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:source,understandingInputVersionIds:["terms","specs","signature"],
  });
  assert.deepEqual(ready,{state:"ready",addedDocumentVersionIds:["signature"],removedDocumentVersionIds:[]});
  assert.equal(assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:source,understandingInputVersionIds:["terms","specs"],
  }).state,"blocked");
  assert.equal(assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:{...source,isStale:true},
    understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
  assert.equal(assessBidSourceReconciliation({
    snapshot:{...snapshot,documents:[doc("terms"),doc("specs"),doc("signature","blocked")],storedDocumentCount:2,blockedDocumentCount:1,snapshotStatus:"blocked"},
    previousDocumentVersionIds:["terms","specs"],requirements:source,understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
});

test("missing or prior-version citation never becomes source-ready just because understanding was regenerated",()=>{
  assert.equal(assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:{...source,requirements:[{...source.requirements[0]!,evidence:[]}]},
    understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
  assert.equal(assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:{...source,requirements:[{...source.requirements[0]!,evidence:[{
      ...source.requirements[0]!.evidence[0]!,opportunityDocumentVersionId:"superseded-version",
    }]}]},
    understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
  assert.equal(assessBidSourceReconciliation({
    snapshot,previousDocumentVersionIds:["terms","specs"],requirements:{...source,requirements:[{...source.requirements[0]!,evidence:[{
      ...source.requirements[0]!.evidence[0]!,excerpt:"  ",
    }]}]},
    understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
});

test("already reconciled state is idempotent, and a new amendment blocks any older understanding",()=>{
  assert.equal(assessBidSourceReconciliation({
    snapshot:{...snapshot,stale:false,supersedesSnapshotId:null},
    previousDocumentVersionIds:["terms","specs"],requirements:source,understandingInputVersionIds:["terms","specs","signature"],
  }).state,"ready");
  assert.equal(assessBidSourceReconciliation({
    snapshot:{...snapshot,currentDocumentSetFingerprint:"new-amendment"},
    previousDocumentVersionIds:["terms","specs"],requirements:source,understandingInputVersionIds:["terms","specs","signature"],
  }).state,"blocked");
});
