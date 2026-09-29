import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("Path 1 exposes the simplified bid workspace and opportunity handoff", () => {
  const bidsIndex = source("app/bids/page.tsx");
  const bidDetail = source("app/bids/[id]/page.tsx");
  const opportunityDetail = source("app/opportunities/[id]/page.tsx");
  const workspaceService = source("lib/bids/workspace.ts");

  assert.match(bidsIndex, /listBidWorkspaces/);
  assert.match(bidDetail, /Source snapshot/);
  assert.match(bidDetail, /Source requirements/);
  assert.match(bidDetail, /id="prepare-bid"/);
  assert.match(bidDetail, /<BidPackageControl/);
  assert.doesNotMatch(bidDetail, /<BidOutlineControl|<GuidedBidProgress|<BidSourceReconciliationAction/);
  assert.match(opportunityDetail, /StartBidButton/);
  assert.doesNotMatch(workspaceService, /generateSolicitationUnderstanding|Gemini|generateContent|AIProvider/);
});

test("disabled generation names source recovery instead of presenting a dead-end verification flow", () => {
  const detail = source("app/bids/[id]/page.tsx");
  const control = source("components/bid-package-control.tsx");
  assert.match(detail, /sourceBlockers/);
  assert.match(detail, /missingEvidence/);
  assert.match(detail, /snapshotStatus/);
  assert.match(control, /sourceBlockers/);
  assert.match(control, /retained solicitation package is not ready for generation/i);
});

test("pending original files have an explicit bounded source-retrieval action without auto-running", () => {
  const detail = source("app/bids/[id]/page.tsx");
  const action = source("components/bid-source-refresh-action.tsx");
  const route = source("app/api/bids/[id]/source-snapshot/route.ts");
  assert.match(detail, /<BidSourceRefreshAction/);
  assert.match(action, /Retrieve source files/);
  assert.match(action, /method: "POST"/);
  assert.doesNotMatch(action, /useEffect|generateBidSectionDraft|generateSolicitationUnderstanding/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /generateBidSectionDraft|generateSolicitationUnderstanding/);
});

test("package download is deterministic and does not call an AI provider", () => {
  const route = source("app/api/bids/[id]/package/route.ts");
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Package manifest/);
  assert.doesNotMatch(route, /createGeminiBidDraftProvider|generateBidSectionDraft|generateFullBidDraft/);
});
