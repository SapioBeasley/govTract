import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("full bid editor exposes explicit save state and package progression", () => {
  const editor = read("components/full-bid-editor.tsx");
  assert.match(editor, /Save draft/);
  assert.match(editor, /Draft saved/);
  assert.match(editor, /Needs your input item\(s\) remain/);
  assert.match(editor, /Save supporting checklist/);
  assert.match(editor, /Approve current package/);
  assert.match(editor, /Download final package/);
});

test("removed requirement cards are replaced by a concise supporting-item checklist", () => {
  const editor = read("components/full-bid-editor.tsx");
  const page = read("app/bids/[id]/page.tsx");
  assert.match(editor, /Supporting documents/);
  assert.match(editor, /Required/);
  assert.match(editor, /Conditional \/ review applicability/);
  assert.doesNotMatch(page, /ComplianceMatrixControl|BidSourceReviewAction|Mark addressed in my bid/);
});
