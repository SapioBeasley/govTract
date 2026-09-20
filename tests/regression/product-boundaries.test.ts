import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("locked product paths have no legacy opportunity matching or go/no-go UI copy", () => {
  const companyPage = source("app/company/page.tsx");
  const companyForm = source("components/company-profile-form.tsx");
  const opportunitiesPage = source("app/opportunities/page.tsx");
  const opportunityDetail = source("app/opportunities/[id]/page.tsx");
  const readme = source("README.md");

  for (const [path, content] of [
    ["app/company/page.tsx", companyPage],
    ["components/company-profile-form.tsx", companyForm],
    ["app/opportunities/page.tsx", opportunitiesPage],
    ["README.md", readme],
  ] as const) {
    assert.doesNotMatch(content, /go\/no-go/i, `${path} must not describe contractor go/no-go evaluation`);
  }

  assert.doesNotMatch(
    opportunitiesPage,
    /Best Matches/,
    "Opportunity discovery must not advertise abandoned automatic match scoring",
  );
  assert.doesNotMatch(
    opportunitiesPage,
    /Saved · pending saved state/,
    "Opportunity discovery must not claim saved state is pending",
  );

  assert.match(
    companyPage,
    /bid preparation|bid drafting/i,
    "Company page should explain its Path 1 bid-preparation purpose",
  );
  assert.match(
    companyForm,
    /bid preparation|bid drafting/i,
    "Company form should explain its Path 1 bid-preparation purpose",
  );

  assert.doesNotMatch(
    opportunityDetail,
    /id="intelligence"/,
    "Opportunity detail must not contain the standalone historical-market Intelligence section",
  );
  assert.match(
    opportunityDetail,
    /Evaluation Criteria/,
    "Opportunity detail should label buyer evaluation criteria unambiguously",
  );

  assert.match(
    readme,
    /Opportunities \/ Bidding/,
    "README should document the Opportunities / Bidding product path",
  );
  assert.match(
    readme,
    /Historical Procurement \/ Market Research/,
    "README should document the Historical Procurement / Market Research product path",
  );});


test("opportunity detail remains solicitation-only and supports mobile bid handoff", () => {
  const detail = source("app/opportunities/[id]/page.tsx");
  const startBid = source("components/start-bid-button.tsx");

  assert.doesNotMatch(
    detail,
    /(?:from|import\s*\()\s*["'][^"']*(?:historical|market-research|opportunity-evaluations)[^"']*["']/i,
    "Viewing a live opportunity must not load standalone market research or evaluation",
  );
  assert.doesNotMatch(detail, /go\s*\/\s*no-go|recurring purchase|market entry/i);
  assert.match(detail, /getOpportunityDetail\(id\)/);
  assert.match(detail, /loadLatestSolicitationUnderstanding\(opportunity\.id\)/);
  assert.match(detail, /<OpportunityDocumentList\b/);
  assert.match(detail, /<StartBidButton\b/);
  assert.match(startBid, /\/bids\//, "Start bid must lead to the bid workspace");
  assert.match(
    detail,
    /These are the buyer(?:'|’)s criteria for evaluating bids/,
    "Evaluation must clearly mean the buyer's solicitation criteria, not market-entry scoring",
  );
  assert.match(
    detail,
    /<nav className="[^"]*flex-wrap[^"]*"/,
    "Mobile section navigation must wrap instead of introducing a horizontal scroll region",
  );
  assert.match(detail, /overflow-x-clip/);
});
