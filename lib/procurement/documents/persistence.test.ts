import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDocumentVersionChange,
  documentMetadataFingerprint,
  hashDocumentContent,
  isSupportedDocumentType,
  type PersistableDocument,
} from "./persistence";

function document(overrides: Partial<PersistableDocument> = {}): PersistableDocument {
  return {
    sourceDocumentKey: "solicitation/specs.pdf",
    sourceDocumentId: "doc-1",
    name: "Specifications.pdf",
    url: "https://example.test/specs.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    sourceMetadata: { key: "solicitation/specs.pdf", bytes: 1024 },
    ...overrides,
  };
}

test("document metadata fingerprints are deterministic", () => {
  const first = documentMetadataFingerprint(
    document({ sourceMetadata: { bytes: 1024, key: "solicitation/specs.pdf" } }),
  );
  const second = documentMetadataFingerprint(
    document({ sourceMetadata: { key: "solicitation/specs.pdf", bytes: 1024 } }),
  );

  assert.equal(first, second);
});

test("retrieval metadata and checksum do not change the source metadata fingerprint", () => {
  const first = documentMetadataFingerprint(document());
  const second = documentMetadataFingerprint(
    document({
      checksumSha256: "abc123",
      retrievedAt: new Date("2026-09-09T12:00:00Z"),
      storageUri: "s3://bucket/specs.pdf",
      contentPersisted: true,
    }),
  );

  assert.equal(first, second);
});

test("unchanged document does not create a new version or require processing", () => {
  const decision = classifyDocumentVersionChange(
    { fingerprint: "same", checksumSha256: "checksum" },
    { fingerprint: "same", checksumSha256: "checksum" },
  );

  assert.deepEqual(decision, {
    change: "unchanged",
    createVersion: false,
    requiresProcessing: false,
  });
});

test("first successful retrieval enriches the existing version and triggers processing once", () => {
  const decision = classifyDocumentVersionChange(
    { fingerprint: "same", checksumSha256: null },
    { fingerprint: "same", checksumSha256: "checksum" },
  );

  assert.deepEqual(decision, {
    change: "retrieved",
    createVersion: false,
    requiresProcessing: true,
  });
});

test("same source metadata with different content creates a content version", () => {
  const decision = classifyDocumentVersionChange(
    { fingerprint: "same", checksumSha256: "old" },
    { fingerprint: "same", checksumSha256: "new" },
  );

  assert.deepEqual(decision, {
    change: "content_changed",
    createVersion: true,
    requiresProcessing: true,
  });
});

test("metadata-only changes create history without pretending content needs reprocessing", () => {
  const decision = classifyDocumentVersionChange(
    { fingerprint: "old", checksumSha256: "same-content" },
    { fingerprint: "new", checksumSha256: "same-content" },
  );

  assert.deepEqual(decision, {
    change: "metadata_changed",
    createVersion: true,
    requiresProcessing: false,
  });
});

test("content hashing uses SHA-256", () => {
  assert.equal(
    hashDocumentContent("govTract"),
    "1a727e0f3f707fac9647f38046093d733fcee301062ef831cb39d53936be1fcd",
  );
});

test("supported MVP document formats are recognized by name or MIME type", () => {
  for (const name of ["a.pdf", "a.docx", "a.xls", "a.xlsx", "a.csv", "a.txt"]) {
    assert.equal(isSupportedDocumentType({ name }), true, name);
  }

  assert.equal(
    isSupportedDocumentType({ mimeType: "application/pdf; charset=binary" }),
    true,
  );
  assert.equal(isSupportedDocumentType({ name: "archive.zip" }), false);
});
