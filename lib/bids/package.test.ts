import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBidPackageTar,
  buildBidPackageManifest,
  evaluateBidPackageReadiness,
  isBidPackageApprovalCurrent,
} from "./package";

const supporting = {
  fingerprint: "support-v1",
  sourceCurrent: true,
  readyForPackage: true,
  blockingItemIds: [] as string[],
  readyItemIds: ["pricing"],
  applicableItemIds: [] as string[],
  items: [
    {
      id: "pricing",
      requirementKey: "pricing:sheet",
      label: "Complete the provided pricing worksheet.",
      kind: "pricing",
      required: true,
      conditional: false,
      originalForm: true,
      action: "external_attachment" as const,
      sourceVersionIds: ["pricing-v1"],
      sourceFiles: ["Pricing Worksheet.xlsx"],
      listingSource: false,
      ready: true,
      applicable: true,
      blocking: false,
    },
  ],
};

test("package readiness blocks unresolved Needs your input and missing supporting material", () => {
  const unresolved = evaluateBidPackageReadiness({
    content: "Response\n\n## Needs your input\n- [NEEDS INPUT: final price]",
    sourceReady: true,
    sourceBlockers: [],
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: supporting,
  });
  assert.equal(unresolved.readyForApproval, false);
  assert.ok(unresolved.blockers.some((blocker) => blocker.code === "needs_input"));

  const missingSupport = evaluateBidPackageReadiness({
    content: "Complete final response.",
    sourceReady: true,
    sourceBlockers: [],
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: {
      ...supporting,
      readyForPackage: false,
      blockingItemIds: ["pricing"],
      readyItemIds: [],
      items: supporting.items.map((item) => ({ ...item, ready: false, blocking: true })),
    },
  });
  assert.equal(missingSupport.readyForApproval, false);
  assert.deepEqual(
    missingSupport.blockers.filter((blocker) => blocker.code === "supporting_item").map((blocker) => blocker.itemId),
    ["pricing"],
  );
});

test("approval is bound to the exact saved response and supporting state", () => {
  const ready = evaluateBidPackageReadiness({
    content: "Complete final response.",
    sourceReady: true,
    sourceBlockers: [],
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: supporting,
  });
  assert.equal(ready.readyForApproval, true);

  const storedApproval = { fingerprint: ready.packageFingerprint, approvedAt: "2026-09-29T04:00:00.000Z" };
  assert.equal(isBidPackageApprovalCurrent(storedApproval, ready.packageFingerprint), true);

  const edited = evaluateBidPackageReadiness({
    content: "Complete final response with one human edit.",
    sourceReady: true,
    sourceBlockers: [],
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: supporting,
  });
  assert.notEqual(edited.packageFingerprint, ready.packageFingerprint);
  assert.equal(isBidPackageApprovalCurrent(storedApproval, edited.packageFingerprint), false);

  const supportChanged = evaluateBidPackageReadiness({
    content: "Complete final response.",
    sourceReady: true,
    sourceBlockers: [],
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: {
      ...supporting,
      fingerprint: "support-v2",
      readyItemIds: ["pricing", "extra"],
    },
  });
  assert.notEqual(supportChanged.packageFingerprint, ready.packageFingerprint);
  assert.equal(isBidPackageApprovalCurrent(storedApproval, supportChanged.packageFingerprint), false);
});

test("manifest and download archive are deterministic and identify external supporting files truthfully", () => {
  const manifest = buildBidPackageManifest({
    workspaceId: "workspace-1",
    opportunityId: "opportunity-1",
    title: "Lift chair bid",
    content: "Exact approved response.",
    packageFingerprint: "package-v1",
    approvedAt: "2026-09-29T04:00:00.000Z",
    snapshotId: "snapshot-1",
    sourceFingerprint: "docs-v1",
    understandingId: "understanding-v1",
    supportingChecklist: supporting,
    submission: {
      url: "https://buyer.example.test/opportunity/1",
      instructions: ["Upload the response and pricing worksheet in the buyer portal."],
    },
  });

  assert.equal(manifest.primaryArtifact.path, "bid-response.md");
  assert.equal(manifest.supportingItems[0]?.delivery, "external");
  assert.equal(manifest.supportingItems[0]?.ready, true);
  assert.equal(manifest.supportingItems[0]?.originalForm, true);
  assert.match(JSON.stringify(manifest), /Pricing Worksheet\.xlsx/);

  const first = buildBidPackageTar("Exact approved response.", manifest);
  const second = buildBidPackageTar("Exact approved response.", manifest);
  assert.deepEqual(first, second);
  assert.equal(first.includes(Buffer.from("bid-response.md")), true);
  assert.equal(first.includes(Buffer.from("manifest.json")), true);
  assert.equal(first.includes(Buffer.from("Exact approved response.")), true);
});

test("source changes block package approval before handoff", () => {
  const result = evaluateBidPackageReadiness({
    content: "Complete final response.",
    sourceReady: false,
    sourceBlockers: ["The solicitation package changed after this bid snapshot."],
    sourceFingerprint: "docs-v2",
    understandingId: "understanding-v1",
    supportingChecklist: { ...supporting, sourceCurrent: false, readyForPackage: false },
  });

  assert.equal(result.readyForApproval, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "source_not_current"));
});
