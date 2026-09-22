import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("Path 1 exposes a real bid workspace and opportunity handoff", () => {
  const bidsIndex = source("app/bids/page.tsx");
  const bidDetail = source("app/bids/[id]/page.tsx");
  const opportunityDetail = source("app/opportunities/[id]/page.tsx");
  const workspaceService = source("lib/bids/workspace.ts");

  assert.doesNotMatch(bidsIndex, /SectionShell[^\n]*title="Bids"/);
  assert.match(bidsIndex, /listBidWorkspaces/);
  assert.match(bidDetail, /Source snapshot/);
  assert.match(bidDetail, /Source requirements/);
  assert.match(bidDetail, /Response sections/);
  assert.match(opportunityDetail, /StartBidButton/);
  assert.doesNotMatch(
    workspaceService,
    /generateSolicitationUnderstanding|Gemini|generateContent|AIProvider/,
    "opening or creating a Bid Workspace must not invoke AI generation",
  );
});


test("disabled AI drafting names the missing source evidence and snapshot recovery instead of a generic dead end", () => {
  const detail=source("app/bids/[id]/page.tsx");
  const draft=source("components/bid-draft-action.tsx");
  const outline=source("components/bid-outline-control.tsx");
  assert.match(detail,/sourceBlockers/);
  assert.match(detail,/requirement_evidence_missing|missingEvidence/);
  assert.match(detail,/pending|snapshotStatus/);
  assert.match(outline,/sourceBlockers/);
  assert.match(draft,/sourceBlockers/);
  assert.doesNotMatch(draft,/Drafting is unavailable until the source snapshot and understanding are complete and current\./);
});

test("pending original files have an explicit bounded source-retrieval action without auto-running on page load", () => {
  const detail=source("app/bids/[id]/page.tsx");
  const action=source("components/bid-source-refresh-action.tsx");
  const route=source("app/api/bids/[id]/source-snapshot/route.ts");
  assert.match(detail,/<BidSourceRefreshAction/);
  assert.match(action,/Retrieve source files/);
  assert.match(action,/method: "POST"/);
  assert.doesNotMatch(action,/useEffect|generateBidSectionDraft|generateSolicitationUnderstanding/);
  assert.match(route,/export async function POST/);
  assert.doesNotMatch(route,/generateBidSectionDraft|generateSolicitationUnderstanding/);
});
