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
    /Opportunities[\\s\\S]*Market Research|Market Research[\\s\\S]*Opportunities/,
    "README should document both locked top-level product paths",
  );
});
