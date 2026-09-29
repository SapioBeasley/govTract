import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSupportingItems,
  evaluateSupportingChecklist,
  supportingChecklistFingerprint,
} from "./supporting-items";

const requirements = {
  understandingId: "22222222-2222-4222-8222-222222222222",
  completenessStatus: "complete" as const,
  incompleteReasons: [] as string[],
  isStale: false,
  requirements: [
    {
      id: "pricing-form",
      requirementKey: "submission:pricing",
      type: "pricing",
      level: "required",
      text: "Complete and return the provided Pricing Worksheet.xlsx.",
      sourceSection: "pricingInstructions",
      sourceFindingKey: "pricing",
      details: { templateRequired: true, templateFilename: "Pricing Worksheet.xlsx" },
      evidence: [{
        opportunityDocumentVersionId: "pricing-v1",
        documentExtractionSegmentId: null,
        locator: { sheet: "Bid" },
        excerpt: "Complete and return the provided Pricing Worksheet.xlsx.",
      }],
      listingEvidence: null,
    },
    {
      id: "insurance",
      requirementKey: "submission:insurance",
      type: "insurance",
      level: "required",
      text: "Submit a certificate of insurance with the bid.",
      sourceSection: "insuranceBonding",
      sourceFindingKey: "insurance",
      details: {},
      evidence: [{
        opportunityDocumentVersionId: "insurance-v1",
        documentExtractionSegmentId: null,
        locator: { page: 9 },
        excerpt: "Submit a certificate of insurance with the bid.",
      }],
      listingEvidence: null,
    },
    {
      id: "literature",
      requirementKey: "submission:literature",
      type: "deliverable",
      level: "unknown",
      text: "If proposing an alternate product, include manufacturer product literature and specifications.",
      sourceSection: "deliverables",
      sourceFindingKey: "literature",
      details: {},
      evidence: [{
        opportunityDocumentVersionId: "scope-v1",
        documentExtractionSegmentId: null,
        locator: { page: 4 },
        excerpt: "If proposing an alternate product, include manufacturer product literature and specifications.",
      }],
      listingEvidence: null,
    },
    {
      id: "scope-only",
      requirementKey: "scope:install",
      type: "scope",
      level: "required",
      text: "Install the chair after delivery.",
      sourceSection: "scope",
      sourceFindingKey: "scope",
      details: {},
      evidence: [{
        opportunityDocumentVersionId: "scope-v1",
        documentExtractionSegmentId: null,
        locator: { page: 2 },
        excerpt: "Install the chair after delivery.",
      }],
      listingEvidence: null,
    },
  ],
};

const documents = [
  { opportunityDocumentVersionId: "pricing-v1", filename: "Pricing Worksheet.xlsx" },
  { opportunityDocumentVersionId: "insurance-v1", filename: "Terms.pdf" },
  { opportunityDocumentVersionId: "scope-v1", filename: "Scope.pdf" },
];

test("supporting checklist includes source-derived required, conditional, and original-form items only", () => {
  const items = deriveSupportingItems({ requirements, documents });

  assert.equal(items.length, 3);
  const pricing = items.find((item) => item.id === "pricing-form");
  assert.ok(pricing);
  assert.equal(pricing.required, true);
  assert.equal(pricing.conditional, false);
  assert.equal(pricing.originalForm, true);
  assert.equal(pricing.action, "external_attachment");
  assert.deepEqual(pricing.sourceFiles, ["Pricing Worksheet.xlsx"]);

  const insurance = items.find((item) => item.id === "insurance");
  assert.equal(insurance?.required, true);
  assert.equal(insurance?.originalForm, false);

  const literature = items.find((item) => item.id === "literature");
  assert.equal(literature?.required, false);
  assert.equal(literature?.conditional, true);
  assert.match(literature?.label ?? "", /product literature/i);

  assert.equal(items.some((item) => item.id === "scope-only"), false);
});

test("required items block readiness while conditional items block only when applicable", () => {
  const items = deriveSupportingItems({ requirements, documents });
  const fingerprint = supportingChecklistFingerprint({
    requirements,
    documentSetFingerprint: "docs-v1",
  });

  const incomplete = evaluateSupportingChecklist(items, {
    fingerprint,
    readyItemIds: [],
    applicableItemIds: [],
  }, fingerprint);
  assert.equal(incomplete.readyForPackage, false);
  assert.deepEqual(new Set(incomplete.blockingItemIds), new Set(["pricing-form", "insurance"]));

  const requiredReady = evaluateSupportingChecklist(items, {
    fingerprint,
    readyItemIds: ["pricing-form", "insurance"],
    applicableItemIds: [],
  }, fingerprint);
  assert.equal(requiredReady.readyForPackage, true);

  const conditionalApplies = evaluateSupportingChecklist(items, {
    fingerprint,
    readyItemIds: ["pricing-form", "insurance"],
    applicableItemIds: ["literature"],
  }, fingerprint);
  assert.equal(conditionalApplies.readyForPackage, false);
  assert.deepEqual(conditionalApplies.blockingItemIds, ["literature"]);

  const allReady = evaluateSupportingChecklist(items, {
    fingerprint,
    readyItemIds: ["pricing-form", "insurance", "literature"],
    applicableItemIds: ["literature"],
  }, fingerprint);
  assert.equal(allReady.readyForPackage, true);
});

test("source or amendment fingerprint changes invalidate prior checklist readiness deterministically", () => {
  const items = deriveSupportingItems({ requirements, documents });
  const oldFingerprint = supportingChecklistFingerprint({
    requirements,
    documentSetFingerprint: "docs-v1",
  });
  const newFingerprint = supportingChecklistFingerprint({
    requirements,
    documentSetFingerprint: "docs-v2-amendment",
  });

  const result = evaluateSupportingChecklist(items, {
    fingerprint: oldFingerprint,
    readyItemIds: ["pricing-form", "insurance", "literature"],
    applicableItemIds: ["literature"],
  }, newFingerprint);

  assert.equal(result.stateCurrent, false);
  assert.equal(result.readyForPackage, false);
  assert.deepEqual(new Set(result.blockingItemIds), new Set(["pricing-form", "insurance"]));
  assert.deepEqual(result.readyItemIds, []);
  assert.deepEqual(result.applicableItemIds, []);
});
