import { createReadStream } from "node:fs";
import { put } from "@vercel/blob";

import {
  SnapshotRetrievalError,
  type SnapshotArtifactStore,
} from "@/lib/procurement/pursuits/snapshot";

type BlobAuthEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "BLOB_READ_WRITE_TOKEN" | "VERCEL_OIDC_TOKEN" | "BLOB_STORE_ID"
  >
>;

type BlobPut = typeof put;

function redactSnapshotFailureMessage(message: string) {
  return message
    .replace(/\b(VERCEL_OIDC_TOKEN|BLOB_READ_WRITE_TOKEN|VERCEL_TOKEN)=\S+/gi, "$1=[REDACTED]")
    .replace(/(Authorization:\s*Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .slice(0, 500);
}

export function describeSnapshotFailureForLog(error: unknown) {
  const code = error instanceof SnapshotRetrievalError ? error.code : "unknown";
  const message = error instanceof Error ? error.message : "Unknown pursuit snapshot failure";
  return {
    code,
    message: redactSnapshotFailureMessage(message),
  };
}

export function createVercelBlobSnapshotArtifactStore(input: {
  token?: string;
  env?: BlobAuthEnvironment;
  putBlob?: BlobPut;
} = {}): SnapshotArtifactStore {
  const env = input.env ?? process.env;
  const explicitToken = input.token;
  const oidcToken = env.VERCEL_OIDC_TOKEN;
  const storeId = env.BLOB_STORE_ID;
  const legacyToken = env.BLOB_READ_WRITE_TOKEN;
  const putBlob = input.putBlob ?? put;

  const authOptions = explicitToken
    ? { token: explicitToken }
    : oidcToken && storeId
      ? { oidcToken, storeId }
      : legacyToken
        ? { token: legacyToken }
        : null;

  return {
    provider: "vercel_blob",
    async putFile(file) {
      if (!authOptions) {
        throw new SnapshotRetrievalError(
          "storage_unavailable",
          "Private pursuit artifact storage is not configured.",
        );
      }

      try {
        const blob = await putBlob(file.storageKey, createReadStream(file.filePath), {
          access: "private",
          ...authOptions,
          addRandomSuffix: false,
          allowOverwrite: true,
          multipart: true,
          ...(file.mimeType ? { contentType: file.mimeType } : {}),
        });

        return {
          storageKey: blob.pathname,
          etag: blob.etag,
        };
      } catch (error) {
        const diagnostic = describeSnapshotFailureForLog(error);
        console.error(
          `PURSUIT_BLOB_STORE_ERROR code=${diagnostic.code} message=${JSON.stringify(diagnostic.message)}`,
        );
        if (error instanceof SnapshotRetrievalError) throw error;
        throw new SnapshotRetrievalError("storage_unavailable", diagnostic.message);
      }
    },
  };
}
