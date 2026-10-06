import assert from "node:assert/strict";
import test from "node:test";

import { bidQuestionProgress } from "@/lib/bids/question-progress";

test("every generated bidder question counts until it has a saved response", () => {
  const progress = bidQuestionProgress([
    { responseNotes: "Quoted at $100 each" },
    { responseNotes: null },
    { responseNotes: "   " },
  ]);

  assert.deepEqual(progress, {
    questionCount: 3,
    answeredQuestionCount: 1,
    unansweredQuestionCount: 2,
  });
});
