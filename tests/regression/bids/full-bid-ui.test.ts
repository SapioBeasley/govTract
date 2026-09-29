import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("bid workspace exposes one full-bid generation and edit surface", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-full-draft-control.tsx");
  const route = read("app/api/bids/[id]/draft/route.ts");

  assert.match(page, /BidFullDraftControl/);
  assert.match(control, />Generate bid</);
  assert.match(control, /Save changes/);
  assert.match(control, /\/api\/bids\/\$\{workspaceId\}\/draft/);
  assert.match(route, /generateFullBidDraft/);
  assert.match(route, /saveFullBidDraft/);
  assert.doesNotMatch(page, /BidOutlineControl/);
  assert.doesNotMatch(page, /GuidedBidProgress/);
  assert.doesNotMatch(page, /BidSourceReconciliationAction/);
  assert.doesNotMatch(page, /Compliance requirements/);
  assert.doesNotMatch(page, /Response sections/);
});

test("full-bid control explains source failure without a verification checklist", () => {
  const control = read("components/bid-full-draft-control.tsx");
  assert.match(control, /sourceBlocker/);
  assert.match(control, /Retrieve source files/);
  assert.doesNotMatch(control, /verify|verification checklist|mark complete/i);
});
