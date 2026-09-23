import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAuthoritativeListingEvidence, type AuthoritativeListingContext,
  findVerbatimRequirementPassage,
} from "./listing-evidence";

const description = '<p>The City of Houston is seeking 10 licenses renewed annually for Polling Platform.</p><p>1 Year Term: October 2026 - October 2027</p><p>****NEED 10 LICENSES PLEASE BID AS ONE LUMP SUM****</p>';
const hash = "a".repeat(64);
const source: AuthoritativeListingContext = {
  record: {
    id: "source-record-1", payloadHash: hash, sourceRevisionId: "rev-1",
    rawPayload: {
      title: "Polling Platform Annual Licenses",
      description: { html: description },
      dueDate: { utcDate: "2026-09-23T17:00:00.000Z" },
      agency: {name:"City of Houston"},
      location:{city:"Houston",region:"TX",country:"US"},
    },
  },
  listing: {
    sourceRecordId: "source-record-1",
    title:"Polling Platform Annual Licenses",description,
    dueAt:new Date("2026-09-23T17:00:00.000Z"),
    agencyName:"City of Houston",location:{locality:"Houston",region:"TX",country:"US"},
    fieldProvenance: Object.fromEntries(["description","title","dueAt","agencyName","location"]
      .map((field) => [field,{authority:"authoritative",sourceRecordPk:"source-record-1"}])),
  },
};

test("authoritative listing source is accepted only when identity, raw payload and field authority agree", () => {
  const cases = [
    ["deliverables","10 interactive polling platform annual licenses for a 1-year term from October 2026 to October 2027.","description"],
    ["pricingInstructions","Bid as one lump sum for all 10 licenses.","description"],
    ["quantities","10 licenses bid as one lump sum.","description"],
    ["schedule","1 Year Term: October 2026 - October 2027.","description"],
    ["schedule","Bids are due by 2026-09-23T17:00:00.000Z.","dueAt"],
    ["location","The solicitation is issued by the City of Houston, TX.","location"],
  ] as const;
  for (const [section,text,field] of cases) {
    const result = resolveAuthoritativeListingEvidence({source,section,text});
    assert.ok(result, section + ": " + text);
    assert.equal(result.field,field);
    assert.equal(result.sourceRecordId,source.record.id);
    assert.equal(result.payloadHash,hash);
    assert.match(result.excerpt,/\S/);
  }
});

test("no made-up source evidence: mismatched source identity, missing authority, tampered source field or unsupported commitment stay unverified", () => {
  for (const change of [
    (s: AuthoritativeListingContext) => { s.listing.fieldProvenance.description = {authority:"secondary",sourceRecordPk:s.record.id}; },
    (s: AuthoritativeListingContext) => { s.listing.fieldProvenance.description = {authority:"authoritative",sourceRecordPk:"another-record"}; },
    (s: AuthoritativeListingContext) => { s.record.rawPayload.description = {html:"Different description"}; },
    (s: AuthoritativeListingContext) => { s.listing.sourceRecordId="mismatched-record"; },
  ]) {
    const changed=structuredClone(source);change(changed);
    assert.equal(resolveAuthoritativeListingEvidence({
      source:changed,section:"pricingInstructions",text:"Bid as one lump sum for all 10 licenses.",
    }),null);
  }
  assert.equal(resolveAuthoritativeListingEvidence({
    source,section:"qualifications",text:"Bidder must have ISO 9001 certification and 20 years of experience.",
  }),null);
  assert.equal(resolveAuthoritativeListingEvidence({
    source,section:"pricingInstructions",text:"Bid 100 licenses as one lump sum.",
  }),null);
  assert.equal(resolveAuthoritativeListingEvidence({
    source,section:"location",text:"Deliver to 100 Fake Road in Houston TX.",
  }),null);
});

test("document fallback requires substantial exact phrase in real extraction, not loose model paraphrase", () => {
  const original = "The Bidder agrees to furnish and deliver bid items, FOB destination point as listed on individual Purchase Orders, in accordance with the City's Specifications.";
  assert.match(findVerbatimRequirementPassage(original,
    "City of Houston, Texas (FOB destination point as listed on individual Purchase Orders).") ?? "", /FOB destination point/);
  assert.equal(findVerbatimRequirementPassage(original,
    "Contractor is certified ISO 9001 and can complete service in two days."),null);
  assert.equal(findVerbatimRequirementPassage("Bids must be received by Tuesday, April 3.",
    "Bids must be received by Thursday, April 3."),null);
});

test("UTC due-date statements match the exact authoritative instant across ISO and English dates, never a nearby hour", () => {
  const s = structuredClone(source);
  s.listing.dueAt = new Date("2026-09-23T20:00:00.000Z");
  s.record.rawPayload.dueDate = { utcDate: "2026-09-23T20:00:00.000Z" };
  const valid = [
    "Submit bids no later than September 23, 2026, at 20:00:00.000Z.",
    "Bids are due by 2026-09-23T20:00:00.000Z.",
  ];
  for (const finding of valid) {
    const proof = resolveAuthoritativeListingEvidence({source:s,section:"schedule",text:finding});
    assert.equal(proof?.field,"dueAt",finding);
    assert.equal(proof?.excerpt,"2026-09-23T20:00:00.000Z");
  }
  for (const finding of [
    "Submit bids no later than September 23, 2026, at 21:00:00.000Z.",
    "Submit bids no later than September 24, 2026, at 20:00:00.000Z.",
    "Submit bids no later than September 23, 2026.",
    "Submit bids no later than September 23, 2026, at 20:00:00.000 Central Time.",
    "Deliver products no later than September 23, 2026, at 20:00:00.000Z.",
  ]) assert.equal(resolveAuthoritativeListingEvidence({source:s,section:"schedule",text:finding}),null,finding);
  const tampered = structuredClone(s);
  tampered.listing.fieldProvenance.dueAt = {authority:"unknown"};
  assert.equal(resolveAuthoritativeListingEvidence({
    source:tampered,section:"schedule",text:valid[0]!,
  }),null);
});

test("FOB destination instructions are grounded only in a substantial verbatim original-source passage",()=>{
  const finding="City of Houston, Texas (FOB destination point as listed on individual Purchase Orders).";
  const original="All supplied goods shall be delivered F.O.B. destination point as listed on individual Purchase Orders, in accordance with the City's specifications.";
  const excerpt=findVerbatimRequirementPassage(original,finding);
  assert.match(excerpt??"",/F\.O\.B\. destination point as listed on individual Purchase Orders/i);
  assert.equal(findVerbatimRequirementPassage(
    "The City may direct shipping to other locations under separate purchase orders.",finding),null);
  assert.equal(findVerbatimRequirementPassage(
    "All goods are FOB shipping point and risk transfers at dispatch.",finding),null);
});

test("captured Houston general-terms FOB clause includes an optional definite article without fabricating a citation",()=>{
  const finding="City of Houston, Texas (FOB destination point as listed on individual Purchase Orders).";
  const original="The Bidder agrees to furnish and deliver bid items, FOB destination point as listed on the individual Purchase Orders, in accordance with the Net Prices and other conditions shown herein.";
  assert.match(findVerbatimRequirementPassage(original,finding)??"",/FOB destination point as listed on the individual Purchase Orders/i);
  assert.equal(findVerbatimRequirementPassage(
    "The Bidder agrees to furnish and deliver bid items, FOB shipping point as listed on the individual Purchase Orders.",finding),null);
});

test("short exact quantity and unit from authoritative listing can be cited without another paid understanding cycle", () => {
  const proof=resolveAuthoritativeListingEvidence({source,section:"quantities",text:"10 licenses."});
  assert.equal(proof?.field,"description");
  assert.match(proof?.excerpt??"",/10 licenses/i);
  for (const text of ["11 licenses.","10 subscriptions.","10 licenses with guaranteed uptime.","10 licenses and 20 tablets."]) {
    assert.equal(resolveAuthoritativeListingEvidence({source,section:"quantities",text}),null,text);
  }
  const unsupported=structuredClone(source);
  unsupported.listing.fieldProvenance.description={authority:"secondary",sourceRecordPk:source.record.id};
  assert.equal(resolveAuthoritativeListingEvidence({source:unsupported,section:"quantities",text:"10 licenses."}),null);
  const changed=structuredClone(source);
  changed.record.rawPayload.description={html:"Seeking only 8 licenses."};
  assert.equal(resolveAuthoritativeListingEvidence({source:changed,section:"quantities",text:"10 licenses."}),null);
  const different=structuredClone(source);
  different.record.rawPayload.description={html:"Seeking only 8 licenses."};
  different.listing.description="Seeking only 8 licenses.";
  assert.equal(resolveAuthoritativeListingEvidence({source:different,section:"quantities",text:"10 licenses."}),null);
});
