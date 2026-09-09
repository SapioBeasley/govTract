import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import { sourceConnections } from "@/lib/db/source-connections-schema";
import {
  authenticateBeaconMagicLink,
  BeaconAuthError,
  parseBeaconMagicLink,
} from "@/lib/procurement/sources/beacon/auth";
import {
  getSourceConnectionSummary,
  saveSourceConnection,
} from "@/lib/source-connections/repository";
import {
  createBrowserSessionEnvelope,
  encryptBrowserSession,
  getSourceSessionEncryptionKey,
} from "@/lib/source-connections/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROVIDER = "beacon";
const PREFLIGHT_PROVIDER = "__govtract_source_connection_preflight__";

type ConnectRequest = {
  magicLink?: unknown;
};

function publicSummary(
  summary: Awaited<ReturnType<typeof getSourceConnectionSummary>>,
) {
  if (!summary) {
    return {
      provider: PROVIDER,
      status: "disconnected" as const,
      accountIdentifier: null,
      sessionExpiresAt: null,
      connectedAt: null,
      lastValidatedAt: null,
      lastError: null,
    };
  }

  return {
    provider: summary.provider,
    status: summary.status,
    accountIdentifier: summary.accountIdentifier,
    sessionExpiresAt: summary.sessionExpiresAt?.toISOString() ?? null,
    connectedAt: summary.connectedAt?.toISOString() ?? null,
    lastValidatedAt: summary.lastValidatedAt?.toISOString() ?? null,
    lastError: summary.lastError,
  };
}

export async function GET() {
  try {
    const summary = await getSourceConnectionSummary(PROVIDER);
    return NextResponse.json({ connection: publicSummary(summary) });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "connection_status_unavailable",
          message: "Beacon connection status is unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let body: ConnectRequest;

  try {
    body = (await request.json()) as ConnectRequest;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Provide the Beacon magic-login link.",
        },
      },
      { status: 400 },
    );
  }

  if (typeof body.magicLink !== "string") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Provide the Beacon magic-login link.",
        },
      },
      { status: 400 },
    );
  }

  try {
    parseBeaconMagicLink(body.magicLink);
  } catch (error) {
    if (error instanceof BeaconAuthError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: "That Beacon login link is not valid. Request a new link and try again.",
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "That Beacon login link could not be validated.",
        },
      },
      { status: 400 },
    );
  }

  // Fully validate the encryption key before consuming a one-time Beacon login credential.
  try {
    const key = getSourceSessionEncryptionKey();
    encryptBrowserSession(createBrowserSessionEnvelope([]), key);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "encryption_invalid",
          message: "Beacon session encryption key is invalid on this deployment.",
        },
      },
      { status: 503 },
    );
  }

  // Exercise the same encrypted insert + read-back path used for a real connection, then
  // remove the disposable row before touching Beacon. This prevents one-time login links
  // from being consumed when the deployment can read the table but cannot persist rows.
  try {
    const preflight = await saveSourceConnection({
      provider: PREFLIGHT_PROVIDER,
      session: createBrowserSessionEnvelope([]),
      metadata: { preflight: true },
    });

    if (preflight.provider !== PREFLIGHT_PROVIDER) {
      throw new Error("Source connection preflight read-back mismatch");
    }

    await getDb()
      .delete(sourceConnections)
      .where(eq(sourceConnections.provider, PREFLIGHT_PROVIDER));
  } catch {
    // Best-effort cleanup in case the insert succeeded but a later preflight step failed.
    try {
      await getDb()
        .delete(sourceConnections)
        .where(eq(sourceConnections.provider, PREFLIGHT_PROVIDER));
    } catch {
      // Never expose database errors or credential material to the client.
    }

    return NextResponse.json(
      {
        error: {
          code: "database_persistence_unavailable",
          message: "Beacon connection storage cannot persist encrypted sessions on this deployment.",
        },
      },
      { status: 503 },
    );
  }

  try {
    const authenticated = await authenticateBeaconMagicLink(body.magicLink);
    const summary = await saveSourceConnection({
      provider: PROVIDER,
      accountIdentifier: authenticated.accountIdentifier,
      session: authenticated.session,
      metadata: {
        authMethod: "magic_link",
        beaconRole: authenticated.role,
      },
    });

    return NextResponse.json({ connection: publicSummary(summary) });
  } catch (error) {
    if (error instanceof BeaconAuthError) {
      const status =
        error.code === "invalid_magic_link"
          ? 400
          : error.code === "browser_unavailable"
            ? 503
            : 401;

      const message =
        error.code === "browser_unavailable"
          ? "The Beacon login browser is temporarily unavailable. Try again shortly."
          : "Beacon could not establish a reusable supplier session. Request a new login link and try again.";

      return NextResponse.json(
        { error: { code: error.code, message } },
        { status },
      );
    }

    // Do not log the exception text here: upstream browser/network exceptions can contain
    // the one-time magic URL. The response intentionally contains no credential material.
    console.error("Beacon connection failed with an unexpected server error");
    return NextResponse.json(
      {
        error: {
          code: "connection_failed",
          message: "Beacon connected, but govTract could not save the session. Request a new login link and try again.",
        },
      },
      { status: 500 },
    );
  }
}
