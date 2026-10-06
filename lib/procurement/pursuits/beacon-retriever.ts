import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  isBeaconPresignedDocumentUrl,
  resolveBeaconDocumentDownloadUrl,
} from "@/lib/procurement/sources/beacon/documents";
import {
  buildBeaconPlanholderRegistrationRequest,
  parseBeaconPlanholderRegistrationResponse,
} from "@/lib/procurement/sources/beacon/registration";
import {
  buildBeaconCookieHeader,
  isBeaconPermissionResponse,
  isBeaconPlanholderRegistrationResponse,
  parseBeaconRegistrationProfile,
} from "@/lib/procurement/sources/beacon/session-transport";
import {
  SnapshotRetrievalError,
  type PursuitDocumentRetriever,
} from "@/lib/procurement/pursuits/snapshot";
import { loadSourceConnectionSession } from "@/lib/source-connections/repository";

const BEACON_ORIGIN = "https://www.beaconbid.com";
const DEFAULT_TIMEOUT_MS = 120_000;
const AUTO_REGISTER = process.env.BEACON_AUTO_REGISTER !== "false";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 pursuit-snapshot";

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  cookieHeader?: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("accept", "*/*");
  if (cookieHeader) {
    const target = new URL(url);
    if (target.origin !== BEACON_ORIGIN || target.protocol !== "https:") {
      throw new SnapshotRetrievalError("http", "Refusing to send Beacon credentials to an unexpected host");
    }
    headers.set("cookie", cookieHeader);
  }
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof SnapshotRetrievalError) throw error;
    throw new SnapshotRetrievalError("network", "Beacon source document request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveResponse(input: {
  downloadUrl: string;
  sourceDocumentKey: string;
  cookieHeader: string;
  timeoutMs: number;
}) {
  const gateway = await fetchWithTimeout(
    input.downloadUrl,
    { method: "GET", redirect: "manual" },
    input.timeoutMs,
    input.cookieHeader,
  );

  if (gateway.status >= 300 && gateway.status < 400) {
    const location = gateway.headers.get("location");
    await gateway.body?.cancel();
    if (
      !location ||
      !isBeaconPresignedDocumentUrl({
        url: location,
        sourceDocumentKey: input.sourceDocumentKey,
      })
    ) {
      throw new SnapshotRetrievalError("http", "Beacon returned an unexpected document redirect");
    }
    return fetchWithTimeout(location, { method: "GET", redirect: "manual" }, input.timeoutMs);
  }

  return gateway;
}

async function loadRegistrationProfile(cookieHeader: string, timeoutMs: number) {
  const response = await fetchWithTimeout(
    `${BEACON_ORIGIN}/api/rest/session`,
    { method: "GET", redirect: "manual" },
    timeoutMs,
    cookieHeader,
  );
  const body = (await response.text()).slice(0, 10_000);
  if (!response.ok) {
    throw new SnapshotRetrievalError(
      "auth_blocked",
      "Beacon supplier session could not be validated before solicitation registration.",
    );
  }
  const profile = parseBeaconRegistrationProfile(body);
  if (!profile) {
    throw new SnapshotRetrievalError(
      "source_restricted",
      "Beacon supplier profile is incomplete for automatic solicitation registration.",
    );
  }
  return profile;
}

async function registerForSolicitation(input: {
  sourceOpportunityId: string;
  cookieHeader: string;
  timeoutMs: number;
}) {
  if (!AUTO_REGISTER) {
    throw new SnapshotRetrievalError(
      "source_restricted",
      "Beacon requires solicitation registration before document retrieval, and automatic registration is disabled.",
    );
  }

  const profile = await loadRegistrationProfile(input.cookieHeader, input.timeoutMs);
  const request = buildBeaconPlanholderRegistrationRequest({
    solicitationId: input.sourceOpportunityId,
    profile,
    interest: "Bidder",
  });
  const response = await fetchWithTimeout(
    `${BEACON_ORIGIN}/api/gql?operation=createPlanholder`,
    {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    input.timeoutMs,
    input.cookieHeader,
  );
  const body = (await response.text()).slice(0, 10_000);
  const result = parseBeaconPlanholderRegistrationResponse(response.status, body);
  if (!result.ok) {
    throw new SnapshotRetrievalError(
      "source_restricted",
      `Beacon automatic solicitation registration failed (HTTP ${response.status}).`,
    );
  }
}

export function createBeaconPursuitDocumentRetriever(input: {
  timeoutMs?: number;
} = {}): PursuitDocumentRetriever {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cookieHeaderPromise: Promise<string> | null = null;
  const registeredSourceOpportunities = new Set<string>();
  const getCookieHeader = () => {
    cookieHeaderPromise ??= loadSourceConnectionSession("beacon")
      .then(buildBeaconCookieHeader)
      .catch(() => {
        throw new SnapshotRetrievalError(
          "auth_blocked",
          "Beacon source connection is unavailable; reconnect Beacon before snapshotting.",
        );
      });
    return cookieHeaderPromise;
  };

  return {
    async retrieveToFile(document) {
      if (document.source.toLowerCase() !== "beacon") {
        throw new SnapshotRetrievalError(
          "source_restricted",
          `No pursuit binary retriever is configured for source ${document.source}.`,
        );
      }

      const downloadUrl = resolveBeaconDocumentDownloadUrl({
        sourceOpportunityId: document.sourceOpportunityId,
        sourceDocumentKey: document.sourceDocumentKey,
      });
      if (!downloadUrl) {
        throw new SnapshotRetrievalError("missing", "Beacon document route could not be resolved");
      }

      const cookieHeader = await getCookieHeader();
      let response = await resolveResponse({
        downloadUrl,
        sourceDocumentKey: document.sourceDocumentKey,
        cookieHeader,
        timeoutMs,
      });

      if (!response.ok) {
        let body = (await response.text()).slice(0, 1000);
        if (
          isBeaconPlanholderRegistrationResponse(response.status, body) &&
          !registeredSourceOpportunities.has(document.sourceOpportunityId)
        ) {
          await registerForSolicitation({
            sourceOpportunityId: document.sourceOpportunityId,
            cookieHeader,
            timeoutMs,
          });
          registeredSourceOpportunities.add(document.sourceOpportunityId);
          response = await resolveResponse({
            downloadUrl,
            sourceDocumentKey: document.sourceDocumentKey,
            cookieHeader,
            timeoutMs,
          });
          if (!response.ok) body = (await response.text()).slice(0, 1000);
        }

        if (!response.ok) {
          if (isBeaconPermissionResponse(response.status, body)) {
            throw new SnapshotRetrievalError(
              "auth_blocked",
              "Beacon denied the current supplier session access to the pursuit document.",
            );
          }
          if (response.status === 404) {
            throw new SnapshotRetrievalError("missing", "Beacon source document is no longer available");
          }
          throw new SnapshotRetrievalError(
            "http",
            `Beacon source document returned HTTP ${response.status}`,
          );
        }
      }
      if (!response.body) {
        throw new SnapshotRetrievalError("missing", "Beacon source document returned no body");
      }

      let byteCount = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          byteCount += Buffer.byteLength(chunk);
          if (byteCount > document.maxBytes) {
            callback(
              new SnapshotRetrievalError(
                "size",
                "Source document exceeds the pursuit snapshot byte limit",
              ),
            );
            return;
          }
          callback(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as never),
          limiter,
          createWriteStream(document.destinationPath, { flags: "wx" }),
        );
      } catch (error) {
        if (error instanceof SnapshotRetrievalError) throw error;
        throw new SnapshotRetrievalError("network", "Beacon source document stream failed");
      }

      return {
        retrievedAt: new Date(),
        mimeType:
          response.headers.get("content-type")?.split(";", 1)[0]?.trim() || document.mimeType,
      };
    },
  };
}
