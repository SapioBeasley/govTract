import assert from "node:assert/strict";
import test from "node:test";

import {
  SnapshotRetrievalError,
  describeSnapshotFailureForLog,
} from "@/lib/procurement/pursuits/snapshot";

test("snapshot failure diagnostics preserve typed retrieval codes", () => {
  const diagnostic = describeSnapshotFailureForLog(
    new SnapshotRetrievalError("storage_unavailable", "Private pursuit artifact storage is not configured."),
  );

  assert.deepEqual(diagnostic, {
    code: "storage_unavailable",
    message: "Private pursuit artifact storage is not configured.",
  });
});

test("snapshot failure diagnostics surface generic errors without leaking credentials", () => {
  const diagnostic = describeSnapshotFailureForLog(
    new Error(
      "Vercel Blob upload failed Authorization: Bearer secret-token-123 VERCEL_OIDC_TOKEN=header.payload.signature BLOB_READ_WRITE_TOKEN=blob_rw_secret",
    ),
  );

  assert.equal(diagnostic.code, "unknown");
  assert.equal(
    diagnostic.message,
    "Vercel Blob upload failed Authorization: Bearer [REDACTED] VERCEL_OIDC_TOKEN=[REDACTED] BLOB_READ_WRITE_TOKEN=[REDACTED]",
  );
});
