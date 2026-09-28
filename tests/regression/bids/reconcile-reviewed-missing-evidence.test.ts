import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

test("reconciliation does not deadlock when only reviewable requirement evidence is missing",()=>{
  const page=read("app/bids/[id]/page.tsx");
  const reconcile=read("lib/bids/source-reconciliation.ts");
  assert.match(page,/sourceEligible/);
  assert.match(page,/canReconcile=\{reconciliationBlockers\.length === 0 && sourceEligible\}/);
  assert.doesNotMatch(page,/missingEvidence\.length\s*\?\s*`\$\{missingEvidence\.length\} requirement\(s\) lack verifiable evidence/);
  assert.match(reconcile,/requirements\.completenessStatus===\"partial\"/);
  assert.match(reconcile,/requirement_evidence_missing/);
});

test("missing evidence remains explicit review work rather than silently verified",()=>{
  const page=read("app/bids/[id]/page.tsx");
  assert.match(page,/missingEvidence\.length/);
  assert.match(page,/sourceBlockers/);
  assert.match(page,/Restore authoritative document or listing provenance/);
});
