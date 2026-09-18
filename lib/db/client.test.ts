import assert from "node:assert/strict";
import test from "node:test";

import { resolveDatabasePoolMax } from "./client";

test("database pool size defaults safely and accepts a bounded explicit override", () => {
  assert.equal(resolveDatabasePoolMax(undefined), 1);
  assert.equal(resolveDatabasePoolMax(""), 1);
  assert.equal(resolveDatabasePoolMax("not-a-number"), 1);
  assert.equal(resolveDatabasePoolMax("0"), 1);
  assert.equal(resolveDatabasePoolMax("16"), 16);
  assert.equal(resolveDatabasePoolMax("1000"), 32);
});
