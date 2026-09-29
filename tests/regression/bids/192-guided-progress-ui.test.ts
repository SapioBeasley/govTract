import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("bid workspace uses one explicit full-bid generation action instead of guided workflow controls", () => {
  const page = read("app/bids/[id]/page.tsx");
  const control = read("components/bid-package-control.tsx");

  assert.match(page, /<BidPackageControl/);
  assert.doesNotMatch(page, /<GuidedBidProgress|<BidSourceReconciliationAction|<BidOutlineControl/);
  assert.match(control, /window\.confirm/);
  assert.match(control, /may incur model cost/i);
  assert.match(control, /fetch\(\`\/api\/bids\/\$\{workspaceId\}\/draft\`/);
  assert.match(control, /Ordinary editing and saving never invoke AI/);
});

test("final handoff still requires exact-package human approval and never claims submission", () => {
  const finalReview = read("components/bid-final-review.tsx");
  assert.match(finalReview, /!review\.readyForHumanReview/);
  assert.match(finalReview, /Approve current package/);
  assert.match(finalReview, /govTract does not submit/);
  assert.match(finalReview, /Download approved package/);
});
