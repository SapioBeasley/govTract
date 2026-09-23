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

  const state = {
    oidc: Boolean(oidcToken),
    store: Boolean(storeId),
    token: Boolean(legacyToken || explicitToken),
  };
  const statusCode = (error:unknown) => {
    if (!error || typeof error!=="object") return null;
    const value=(error as {status?:unknown;statusCode?:unknown}).status ??
      (error as {statusCode?:unknown}).statusCode;
    return typeof value==="number" && Number.isInteger(value) && value>=100 && value<=599
      ? value : null;
  };
  const isAuthFailure=(error:unknown) => {
    const status=statusCode(error);
    return status===401 || status===403 ||
      (error instanceof Error && /\\b(unauthorized|forbidden|not authorized|invalid token|expired token|oidc is not|permission denied)\\b/i.test(error.message));
  };
  const upload=(file:Parameters<SnapshotArtifactStore["putFile"]>[0],
    options:NonNullable<typeof authOptions>) =>
    putBlob(file.storageKey,createReadStream(file.filePath),{
      access:"private",
      ...options,addRandomSuffix:false,allowOverwrite:true,multipart:true,
      ...(file.mimeType?{contentType:file.mimeType}:{}),
    });
  return {
    provider:"vercel_blob",
    async putFile(file) {
      if (!authOptions) {
        console.error(`PURSUIT_BLOB_STORE_ERROR code=storage_unavailable reason=storage_unconfigured oidc=${state.oidc} store=${state.store} token=${state.token}`);
        throw new SnapshotRetrievalError("storage_unavailable",
          "Private pursuit artifact storage is not configured.");
      }
      let mode=explicitToken?"explicit_token":oidcToken && storeId?"oidc":"token";
      try {
        let blob;
        try {
          blob=await upload(file,authOptions);
        } catch (error) {
          if (!explicitToken && oidcToken && storeId && legacyToken && isAuthFailure(error)) {
            mode="fallback_token";
            blob=await upload(file,{token:legacyToken});
          } else {
            throw error;
          }
        }
        return {storageKey:blob.pathname,etag:blob.etag};
      } catch (error) {
        const diagnostic=describeSnapshotFailureForLog(error);
        const classification=isAuthFailure(error)?"auth_failure":"provider_failure";
        console.error(
          `PURSUIT_BLOB_STORE_ERROR code=${diagnostic.code} reason=${classification} status=${statusCode(error)??"unknown"} mode=${mode} oidc=${state.oidc} store=${state.store} token=${state.token} message=${JSON.stringify(diagnostic.message)}`,
        );
        if (error instanceof SnapshotRetrievalError) throw error;
        throw new SnapshotRetrievalError("storage_unavailable",diagnostic.message);
      }
    },
  };
}
