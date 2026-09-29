import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("bid workspace shows a bidder-facing supporting materials checklist after the full draft", () => {
  const page = read("app/bids/[id]/page.tsx");
  const checklist = read("components/bid-supporting-checklist.tsx");

  assert.match(page, /BidSupportingChecklist/);
  assert.match(checklist, /Supporting materials/);
  assert.match(checklist, /I have\/provided this/);
  assert.match(checklist, /Applies to this bid/);
  assert.match(checklist, /Required/);
  assert.match(checklist, /Conditional/);
  assert.match(checklist, /external procurement system|buyer portal/i);
  assert.doesNotMatch(checklist, /verified|verification/i);
});

test("supporting checklist updates are deterministic and never call AI", () => {
  const route = read("app/api/bids/[id]/supporting-items/route.ts");
  assert.match(route, /updateBidSupportingItem/);
  assert.match(route, /getBidSupportingChecklist/);
  assert.doesNotMatch(route, /generate|Gemini|provider/i);
});
