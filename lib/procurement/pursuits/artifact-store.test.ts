import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { PutBlobResult } from "@vercel/blob";

import { createVercelBlobSnapshotArtifactStore } from "@/lib/procurement/pursuits/artifact-store";
import { SnapshotRetrievalError } from "@/lib/procurement/pursuits/snapshot";

type PutBlob = typeof import("@vercel/blob").put;

type PutCall = {
  pathname: string;
  options: Record<string, unknown>;
};

const filePath = fileURLToPath(import.meta.url);

function createPutBlobMock(calls: PutCall[]): PutBlob {
  return async (pathname, body, options) => {
    if (body && typeof body === "object" && Symbol.asyncIterator in body) {
      for await (const _chunk of body as AsyncIterable<unknown>) {
        // Drain the file stream so the test does not leave an open handle.
      }
    }

    calls.push({
      pathname,
      options: options as unknown as Record<string, unknown>,
    });

    return {
      pathname,
      etag: "etag-1",
    } as PutBlobResult;
  };
}

const artifact = {
  filePath,
  storageKey: "pursuits/opportunity-1/document-1/version-1/source.pdf",
  mimeType: "application/pdf",
  checksumSha256: "abc123",
  byteCount: 123,
};

test("Vercel Blob pursuit artifacts prefer project OIDC over an ambient read-write token", async () => {
  const calls: PutCall[] = [];
  const store = createVercelBlobSnapshotArtifactStore({
    env: {
      VERCEL_OIDC_TOKEN: "oidc-token",
      BLOB_STORE_ID: "store_123",
      BLOB_READ_WRITE_TOKEN: "legacy-env-token",
    },
    putBlob: createPutBlobMock(calls),
  });

  const result = await store.putFile(artifact);

  assert.deepEqual(result, {
    storageKey: artifact.storageKey,
    etag: "etag-1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.pathname, artifact.storageKey);
  assert.equal(calls[0]?.options.access, "private");
  assert.equal(calls[0]?.options.addRandomSuffix, false);
  assert.equal(calls[0]?.options.allowOverwrite, true);
  assert.equal(calls[0]?.options.multipart, true);
  assert.equal(calls[0]?.options.contentType, "application/pdf");
  assert.equal(calls[0]?.options.oidcToken, "oidc-token");
  assert.equal(calls[0]?.options.storeId, "store_123");
  assert.equal(calls[0]?.options.token, undefined);
});

test("Vercel Blob pursuit artifacts keep an explicit legacy token fallback", async () => {
  const calls: PutCall[] = [];
  const store = createVercelBlobSnapshotArtifactStore({
    token: "legacy-token",
    env: {},
    putBlob: createPutBlobMock(calls),
  });

  await store.putFile(artifact);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.options.token, "legacy-token");
  assert.equal(calls[0]?.options.oidcToken, undefined);
  assert.equal(calls[0]?.options.storeId, undefined);
});

test("Vercel Blob pursuit artifacts fail closed when neither OIDC nor a legacy token is configured", async () => {
  const calls: PutCall[] = [];
  const store = createVercelBlobSnapshotArtifactStore({
    env: {},
    putBlob: createPutBlobMock(calls),
  });

  await assert.rejects(
    () => store.putFile(artifact),
    (error: unknown) => {
      assert.ok(error instanceof SnapshotRetrievalError);
      assert.equal(error.code, "storage_unavailable");
      return true;
    },
  );
  assert.equal(calls.length, 0);
});
