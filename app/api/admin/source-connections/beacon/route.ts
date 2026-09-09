import { NextResponse } from "next/server";

import {
  authenticateBeaconMagicLink,
  BeaconAuthError,
  parseBeaconMagicLink,
} from "@/lib/procurement/sources/beacon/auth";
import {
  getSourceConnectionSummary,
  saveSourceConnection,
} from "@/lib/source-connections/repository";
import { getSourceSessionEncryptionKey } from "@/lib/source-connections/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROVIDER = "beacon";

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
    // Validate the credential shape before touching infrastructure, then verify that
    // persistence is ready before consuming this one-time login credential.
    parseBeaconMagicLink(body.magicLink);
    getSourceSessionEncryptionKey();
    await getSourceConnectionSummary(PROVIDER);
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
          code: "connection_not_configured",
          message: "Beacon connection storage is not configured on this deployment.",
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
