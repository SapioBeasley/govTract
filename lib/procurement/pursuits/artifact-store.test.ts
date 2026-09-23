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

async function drainBlobBody(body: unknown) {
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    for await (const _chunk of body as AsyncIterable<unknown>) {
      // Drain the file stream so the test does not leave an open handle.
    }
  }
}

function createPutBlobMock(calls: PutCall[]): PutBlob {
  return async (pathname, body, options) => {
    await drainBlobBody(body);

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

test("Vercel Blob SDK failures are blocked as storage unavailable and logged without credentials", async () => {
  const messages: string[] = [];
  const originalConsoleError = console.error;
  const failingPutBlob: PutBlob = async (_pathname, body) => {
    await drainBlobBody(body);
    throw new Error(
      "OIDC is enabled for this project, but not for this token's environment. Authorization: Bearer secret-token VERCEL_OIDC_TOKEN=header.payload.signature",
    );
  };
  const store = createVercelBlobSnapshotArtifactStore({
    env: {
      VERCEL_OIDC_TOKEN: "oidc-token",
      BLOB_STORE_ID: "store_123",
    },
    putBlob: failingPutBlob,
  });

  console.error = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try {
    await assert.rejects(
      () => store.putFile(artifact),
      (error: unknown) => {
        assert.ok(error instanceof SnapshotRetrievalError);
        assert.equal(error.code, "storage_unavailable");
        assert.equal(
          error.message,
          "OIDC is enabled for this project, but not for this token's environment. Authorization: Bearer [REDACTED] VERCEL_OIDC_TOKEN=[REDACTED]",
        );
        return true;
      },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /PURSUIT_BLOB_STORE_ERROR code=unknown/);
  assert.match(messages[0]!, /OIDC is enabled for this project/);
  assert.doesNotMatch(messages[0]!, /secret-token|header\.payload\.signature/);
});

test("runtime falls back to scoped private Blob token when Vercel OIDC upload is rejected, without exposing credentials", async () => {
  const calls:Record<string,unknown>[]=[];
  const messages:string[]=[];
  const old=console.error;
  const putBlob:PutBlob=async(_path,body,options)=>{
    await drainBlobBody(body);
    calls.push(options as unknown as Record<string,unknown>);
    if (calls.length===1) throw Object.assign(new Error("OIDC is not authorized in this deployment"),{status:403});
    return {pathname:artifact.storageKey,etag:"etag-fallback"} as PutBlobResult;
  };
  console.error=(...parts:unknown[])=>messages.push(parts.map(String).join(" "));
  try {
    const store=createVercelBlobSnapshotArtifactStore({
      env:{VERCEL_OIDC_TOKEN:"oidc-secret",BLOB_STORE_ID:"store_123",
        BLOB_READ_WRITE_TOKEN:"blob_rw_secret"},putBlob,
    });
    const result=await store.putFile(artifact);
    assert.equal(result.etag,"etag-fallback");
  } finally {
    console.error=old;
  }
  assert.equal(calls.length,2);
  assert.equal(calls[0]?.oidcToken,"oidc-secret");
  assert.equal(calls[1]?.token,"blob_rw_secret");
  assert.equal(calls[1]?.oidcToken,undefined);
  assert.doesNotMatch(messages.join(" "),/oidc-secret|blob_rw_secret/);
});

test("failed original private Blob storage provides actionable redacted auth diagnostics",async()=>{
  const errors:string[]=[];
  const old=console.error;
  const putBlob:PutBlob=async(_path,body)=>{
    await drainBlobBody(body);
    throw Object.assign(new Error("Forbidden Authorization: Bearer secret-token"),{status:403});
  };
  console.error=(...parts:unknown[])=>errors.push(parts.map(String).join(" "));
  try {
    const store=createVercelBlobSnapshotArtifactStore({env:{
      VERCEL_OIDC_TOKEN:"oidc-secret",BLOB_STORE_ID:"store_123",
    },putBlob});
    await assert.rejects(()=>store.putFile(artifact),(error:unknown)=>{
      assert.ok(error instanceof SnapshotRetrievalError);
      assert.equal(error.code,"storage_unavailable");
      assert.doesNotMatch(error.message,/secret-token/);
      return true;
    });
  } finally {console.error=old;}
  assert.match(errors.join(" "),/auth_failure|403/);
  assert.match(errors.join(" "),/oidc=true/);
  assert.doesNotMatch(errors.join(" "),/oidc-secret|secret-token/);
});
