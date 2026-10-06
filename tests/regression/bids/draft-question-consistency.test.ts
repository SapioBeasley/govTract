import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("draft preflight uses requirement text when deciding bidder questions", () => {
  const source = readFileSync(join(process.cwd(), "lib/bids/draft-input.ts"), "utf8");
  assert.match(
    source,
    /requirementNeedsBidderQuestion\(\{\s*requirementType: requirement\.type,\s*text: requirement\.text,?\s*\}/,
  );
});
