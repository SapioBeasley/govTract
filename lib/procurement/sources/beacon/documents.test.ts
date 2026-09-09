import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBeaconAmendment,
  enrichBeaconDocumentMetadata,
  normalizeBeaconEtag,
  resolveBeaconDocumentUrl,
} from "./documents";

test("resolves Beacon bucket and key into a deterministic source URL", () => {
  assert.equal(
    resolveBeaconDocumentUrl({
      sourceDocumentKey: "agency/a/solicitation/b/My File.pdf",
      sourceMetadata: {
        bucket: "documents.beaconbid.com",
        key: "agency/a/solicitation/b/My File.pdf",
      },
    }),
    "https://documents.beaconbid.com/agency/a/solicitation/b/My%20File.pdf",
  );
});

test("preserves an explicit document URL", () => {
  assert.equal(
    resolveBeaconDocumentUrl({
      sourceDocumentKey: "ignored",
      sourceMetadata: { bucket: "documents.beaconbid.com", key: "ignored" },
      existingUrl: "https://example.test/document.pdf",
    }),
    "https://example.test/document.pdf",
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

test("enriches Beacon document metadata without storing file content", () => {
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

  assert.equal(
    enriched.url,
    "https://documents.beaconbid.com/agency/a/solicitation/b/Amendment1.pdf",
  );
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
