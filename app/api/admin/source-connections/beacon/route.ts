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

type AuthenticatedBeacon = Awaited<ReturnType<typeof authenticateBeaconMagicLink>>;

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
    try {
      await getDb()
        .delete(sourceConnections)
        .where(eq(sourceConnections.provider, PREFLIGHT_PROVIDER));
    } catch {
      // Best-effort cleanup only.
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

  let authenticated: AuthenticatedBeacon;

  try {
    authenticated = await authenticateBeaconMagicLink(body.magicLink);
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
          : error.code === "session_cookie_missing"
            ? "Beacon authenticated, but no reusable supplier session cookie was captured. Request a new login link and try again."
            : error.code === "session_restore_failed"
              ? "Beacon session was captured, but it could not be restored in a fresh browser. Request a new login link and try again."
              : error.code === "authentication_timeout"
                ? "Beacon did not finish establishing supplier access before the login attempt timed out. Request a new login link and try again."
                : "Beacon could not establish a reusable supplier session. Request a new login link and try again.";

      return NextResponse.json(
        { error: { code: error.code, message } },
        { status },
      );
    }

    console.error("Beacon authentication failed with an unexpected server error");
    return NextResponse.json(
      {
        error: {
          code: "session_capture_failed",
          message: "Beacon authenticated, but govTract could not capture a reusable supplier session. Request a new login link and try again.",
        },
      },
      { status: 500 },
    );
  }

  try {
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
  } catch {
    console.error("Beacon session persistence failed after successful authentication");
    return NextResponse.json(
      {
        error: {
          code: "session_persistence_failed",
          message: "Beacon authenticated, but govTract could not persist the encrypted session. Request a new login link and try again.",
        },
      },
      { status: 500 },
    );
  }
}
