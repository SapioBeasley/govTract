import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  disconnectSourceConnection,
  getSourceConnectionSummary,
  loadSourceConnectionSession,
  markSourceConnectionNeedsReauth,
  saveSourceConnection,
} from "./repository";
import { createBrowserSessionEnvelope } from "./session";

const canRun = Boolean(
  process.env.DATABASE_URL && process.env.SOURCE_SESSION_ENCRYPTION_KEY,
);

test(
  "source connection persists encrypted session and restores it",
  { skip: !canRun },
  async () => {
    const provider = "integration-test";
    const secretCookieValue = "integration-secret-cookie";
    const session = createBrowserSessionEnvelope([
      {
        name: "_bs",
        value: secretCookieValue,
        domain: ".www.beaconbid.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 86_400,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    try {
      const saved = await saveSourceConnection({
        provider,
        accountIdentifier: "test@example.invalid",
        session,
        metadata: { adapter: "test" },
      });

      assert.equal(saved.provider, provider);
      assert.equal(saved.status, "connected");
      assert.equal(saved.accountIdentifier, "test@example.invalid");
      assert.ok(saved.sessionExpiresAt);

      const restored = await loadSourceConnectionSession(provider);
      assert.deepEqual(restored, session);

      const sql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        prepare: false,
      });
      try {
        const [row] = await sql<{ encrypted_session: string | null }[]>`
          SELECT encrypted_session
          FROM source_connections
          WHERE provider = ${provider}
        `;
        assert.ok(row?.encrypted_session);
        assert.equal(row.encrypted_session.includes(secretCookieValue), false);
      } finally {
        await sql.end({ timeout: 5 });
      }

      await markSourceConnectionNeedsReauth(provider, "session_invalid");
      const needsReauth = await getSourceConnectionSummary(provider);
      assert.equal(needsReauth?.status, "needs_reauth");
      assert.equal(needsReauth?.lastError, "session_invalid");

      await assert.rejects(
        () => loadSourceConnectionSession(provider),
        /not_connected/,
      );

      await disconnectSourceConnection(provider);
      const disconnected = await getSourceConnectionSummary(provider);
      assert.equal(disconnected?.status, "disconnected");
      assert.equal(disconnected?.sessionExpiresAt, null);
    } finally {
      const sql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        prepare: false,
      });
      try {
        await sql`DELETE FROM source_connections WHERE provider = ${provider}`;
      } finally {
        await sql.end({ timeout: 5 });
        await closeDb();
      }
    }
  },
);
