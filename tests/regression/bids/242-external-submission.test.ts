import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  currentSubmissionForPackage,
  effectiveBidStatus,
  type BidSubmissionRecord,
} from "@/lib/bids/submission";
import type { BidWorkspaceStatus } from "@/lib/bids/workspace-types";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function submission(overrides: Partial<BidSubmissionRecord> = {}): BidSubmissionRecord {
  return {
    id: "submission-1",
    bidWorkspaceId: "workspace-1",
    reviewFingerprint: "fingerprint-1",
    submittedAt: new Date("2026-09-30T20:00:00.000Z"),
    confirmationNumber: "CONF-123",
    receiptUrl: "https://example.gov/receipt/123",
    notes: "Portal receipt retained.",
    createdAt: new Date("2026-09-30T20:01:00.000Z"),
    updatedAt: new Date("2026-09-30T20:01:00.000Z"),
    ...overrides,
  };
}

test("approved package is not Submitted until an explicit matching external-submission record exists", () => {
  assert.equal(currentSubmissionForPackage([], "fingerprint-1", true), null);
  assert.equal(effectiveBidStatus("complete", null), "complete");

  const recorded = submission();
  assert.equal(currentSubmissionForPackage([recorded], "fingerprint-1", true)?.id, recorded.id);
  assert.equal(effectiveBidStatus("complete", recorded), "submitted");
});

test("submission is bound to the exact approved package and old records remain historical", () => {
  const old = submission();
  assert.equal(currentSubmissionForPackage([old], "fingerprint-2", true), null);
  assert.equal(currentSubmissionForPackage([old], "fingerprint-1", false), null);
  assert.equal(effectiveBidStatus("submitted", null), "complete",
    "a later package revision must not inherit Submitted from a prior package");

  const newer = submission({
    id: "submission-2",
    reviewFingerprint: "fingerprint-2",
    submittedAt: new Date("2026-10-01T14:00:00.000Z"),
  });
  assert.equal(currentSubmissionForPackage([newer, old], "fingerprint-2", true)?.id, "submission-2");
});

test("issue 242 persists append-only submission evidence and exposes an explicit confirmation route", () => {
  const schema = read("lib/db/canonical-schema.ts");
  const migration = read("drizzle/0021_bid_external_submissions.sql");
  const service = read("lib/bids/submission-persistence.ts");
  const route = read("app/api/bids/[id]/submission/route.ts");

  assert.match(schema, /bidSubmissions/);
  assert.match(schema, /reviewFingerprint/);
  assert.match(schema, /confirmationNumber/);
  assert.match(schema, /receiptUrl/);
  assert.match(migration, /CREATE TABLE bid_submissions/i);
  assert.match(migration, /review_fingerprint/i);
  assert.match(service, /finalReviewApprovalCurrent/);
  assert.match(service, /reviewFingerprint/);
  assert.match(service, /submittedAt/);
  assert.match(route, /recordExternalSubmission/);
  assert.match(route, /confirmationNumber/);
  assert.match(route, /receiptUrl/);
});

test("bid detail and list distinguish Approved from Submitted without claiming govTract submitted", () => {
  const review = read("components/bid-final-review.tsx");
  const detail = read("app/bids/[id]/page.tsx");
  const list = read("app/bids/page.tsx");

  assert.match(review, /Submit externally/i);
  assert.match(review, /Confirm submission/i);
  assert.match(review, /govTract.*does not submit/i);
  assert.match(review, /confirmation.*reference/i);
  assert.match(review, /receipt/i);
  assert.match(detail, /currentSubmission/);
  assert.match(list, /Submitted/);
});

test("Submitted cannot be selected through the generic workspace-status patch", () => {
  const service = read("lib/bids/workspace.ts");
  const control = read("components/bid-workspace-control.tsx");

  assert.match(service, /external submission confirmation/i);
  assert.match(control, /submitted/);
});

test("workspace status type includes Submitted for read models", () => {
  const status: BidWorkspaceStatus = "submitted";
  assert.equal(status, "submitted");
});
