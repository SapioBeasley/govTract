import { createReadStream } from "node:fs";
import { put } from "@vercel/blob";

import {
  SnapshotRetrievalError,
  type SnapshotArtifactStore,
} from "@/lib/procurement/pursuits/snapshot";

export function createVercelBlobSnapshotArtifactStore(input: {
  token?: string;
} = {}): SnapshotArtifactStore {
  const token = input.token ?? process.env.BLOB_READ_WRITE_TOKEN;

  return {
    provider: "vercel_blob",
    async putFile(file) {
      if (!token) {
        throw new SnapshotRetrievalError(
          "storage_unavailable",
          "Private pursuit artifact storage is not configured.",
        );
      }

      const blob = await put(file.storageKey, createReadStream(file.filePath), {
        access: "private",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        multipart: true,
        ...(file.mimeType ? { contentType: file.mimeType } : {}),
      });

      return {
        storageKey: blob.pathname,
        etag: blob.etag,
      };
    },
  };
}
