import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { BidFinalReview } from "@/components/bid-final-review";
import type { BidWorkspaceRecord } from "@/lib/bids/workspace";

/** Render the real client component through SSR, as Next does when Start Bid navigates to /bids/[id]. */
function renderReview(dueAt: Date | null) {
  const review = {
    blockingIssues: [],
    readyForHumanReview: false,
    readyForExternalSubmission: false,
    reviewFingerprint: "fixture",
    sourceChecks: [],
    submission: {
      portalUrl: null,
      dueAt,
      method: "Unverified",
      instructions: [],
    },
  } satisfies BidWorkspaceRecord["finalReview"];

  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never },
      createElement(BidFinalReview, {
        workspaceId: "57115fdc-4530-47f4-a584-79068b7ea247",
        opportunityId: "4d3953da-72ee-466b-87cf-e7e7c9766fa0",
        review,
        confirmedOriginalForms: [],
        approvalCurrent: false,
      }),
    ),
  );
}

test("final review SSR renders a real submission deadline in Chicago time without crashing", () => {
  const html = renderReview(new Date("2026-10-02T17:00:00Z"));
  assert.match(html, /Friday, October 2, 2026/);
  assert.match(html, /12:00 PM CDT/);
  assert.match(html, /Authoritative submission handoff/);
});

test("final review SSR handles an unknown submission deadline", () => {
  assert.match(renderReview(null), /Not verified — check source instructions/);
});
