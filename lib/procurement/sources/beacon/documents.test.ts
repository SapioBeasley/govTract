import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBeaconAmendment,
  enrichBeaconDocumentMetadata,
  normalizeBeaconEtag,
  resolveBeaconDocumentDownloadUrl,
  resolveBeaconDocumentUrl,
} from "./documents";

test("does not treat Beacon storage buckets as public URLs", () => {
  assert.equal(resolveBeaconDocumentUrl({}), null);
});

test("preserves an explicit document URL", () => {
  assert.equal(
    resolveBeaconDocumentUrl({ existingUrl: "https://example.test/document.pdf" }),
    "https://example.test/document.pdf",
  );
});

test("builds the Beacon planholder document route with the full key encoded", () => {
  assert.equal(
    resolveBeaconDocumentDownloadUrl({
      sourceOpportunityId: "abc-123",
      sourceDocumentKey: "agency/a/solicitation/b/My File.pdf",
    }),
    "https://www.beaconbid.com/api/planholder/document/abc-123/agency%2Fa%2Fsolicitation%2Fb%2FMy%20File.pdf",
  );
});

test("classifies Beacon amendments from names or detail labels", () => {
  assert.deepEqual(
    classifyBeaconAmendment({ name: "Addendum 2.pdf", sourceMetadata: { detail: "Other" } }),
    { isAmendment: true, amendmentLabel: "Other" },
  );
  assert.deepEqual(
    classifyBeaconAmendment({ name: "Plans.pdf", sourceMetadata: { detail: "Clarification" } }),
    { isAmendment: true, amendmentLabel: "Clarification" },
  );
  assert.deepEqual(
    classifyBeaconAmendment({ name: "Specifications.pdf", sourceMetadata: { detail: "Solicitation" } }),
    { isAmendment: false, amendmentLabel: null },
  );
});

test("enriches Beacon document metadata without inventing a public bucket URL", () => {
  const enriched = enrichBeaconDocumentMetadata({
    sourceDocumentKey: "agency/a/solicitation/b/Amendment1.pdf",
    name: "Amendment 1.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 123,
    sourceMetadata: {
      bucket: "documents.beaconbid.com",
      key: "agency/a/solicitation/b/Amendment1.pdf",
      createdAt: "2026-09-01T12:30:00.000Z",
      detail: "Addendum",
    },
  });

  assert.equal(enriched.url, null);
  assert.equal(enriched.sourceModifiedAt?.toISOString(), "2026-09-01T12:30:00.000Z");
  assert.equal(enriched.isAmendment, true);
  assert.equal(enriched.amendmentLabel, "Addendum");
  assert.equal(enriched.contentPersisted, undefined);
});

test("normalizes weak and quoted ETags", () => {
  assert.equal(normalizeBeaconEtag('W/"abc123"'), "abc123");
  assert.equal(normalizeBeaconEtag('"abc123"'), "abc123");
  assert.equal(normalizeBeaconEtag(null), null);
});
