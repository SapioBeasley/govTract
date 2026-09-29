import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("bid workspace exposes explicit exact-version approval, deterministic download, and external handoff", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");

  assert.match(page, /BidPackageControl/);
  assert.match(control, /Approve exact saved bid/);
  assert.match(control, /Download package/);
  assert.match(control, /govTract has not submitted this bid/i);
  assert.match(control, /Open external procurement system/);
  assert.match(control, /manifest\.json/);
});

test("package approval and download routes contain no AI invocation path", () => {
  const route = read("app/api/bids/[id]/package/route.ts");
  const download = read("app/api/bids/[id]/package/download/route.ts");

  assert.match(route, /approveBidPackage/);
  assert.match(route, /getBidPackageStatus/);
  assert.match(download, /buildApprovedBidPackage/);
  assert.doesNotMatch(route, /Gemini|provider|generate/i);
  assert.doesNotMatch(download, /Gemini|provider|generate/i);
});


test("saved response and supporting-material changes refresh exact-version approval state", () => {
  const draft = read("components/bid-full-draft-control.tsx");
  const checklist = read("components/bid-supporting-checklist.tsx");

  assert.match(draft, /useRouter/);
  assert.match(draft, /router\.refresh\(\)/);
  assert.match(checklist, /useRouter/);
  assert.match(checklist, /router\.refresh\(\)/);
});
