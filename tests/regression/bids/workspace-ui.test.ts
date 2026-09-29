import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("opening a bid workspace does not trigger AI generation", () => {
  const page = source("app/bids/[id]/page.tsx");
  const workspace = source("lib/bids/workspace.ts");
  assert.doesNotMatch(page, /generateSolicitationUnderstanding|generateBidSectionDraft|provider\.generate/);
  assert.doesNotMatch(workspace, /generateSolicitationUnderstanding|generateBidSectionDraft|provider\.generate/);
});

test("bid page has one explicit manual generation route and keeps source recovery separate", () => {
  const editor = source("components/full-bid-editor.tsx");
  const route = source("app/api/bids/[id]/draft/route.ts");
  const sourceAction = source("components/bid-source-refresh-action.tsx");
  assert.match(editor, /\/api\/bids\/\$\{workspaceId\}\/draft/);
  assert.match(route, /generateFullBidDraft/);
  assert.match(sourceAction, /independent of paid AI drafting/);
});

test("opportunity still links into the bid workspace", () => {
  const opportunityDetail = source("app/opportunities/[id]/page.tsx");
  assert.match(opportunityDetail, /StartBidButton/);
});
