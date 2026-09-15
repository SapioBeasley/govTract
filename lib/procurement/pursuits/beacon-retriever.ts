import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunities } from "@/lib/db/schema";
import {
  isBeaconPresignedDocumentUrl,
  resolveBeaconDocumentDownloadUrl,
} from "@/lib/procurement/sources/beacon/documents";
import {
  buildBeaconCookieHeader,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
} from "@/lib/procurement/sources/beacon/session-transport";
import {
  SnapshotRetrievalError,
  type PursuitDocumentRetriever,
} from "@/lib/procurement/pursuits/snapshot";
import { loadSourceConnectionSession } from "@/lib/source-connections/repository";

const BEACON_ORIGIN = "https://www.beaconbid.com";
const DEFAULT_TIMEOUT_MS = 120_000;
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
    if (!location || !isBeaconPresignedDocumentUrl({ url: location, sourceDocumentKey: input.sourceDocumentKey })) {
      throw new SnapshotRetrievalError("http", "Beacon returned an unexpected document redirect");
    }
    return fetchWithTimeout(location, { method: "GET", redirect: "manual" }, input.timeoutMs);
  }

  return gateway;
}

export function createBeaconPursuitDocumentRetriever(input: {
  timeoutMs?: number;
} = {}): PursuitDocumentRetriever {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cookieHeaderPromise: Promise<string> | null = null;
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

      const db = getDb();
      const [opportunity] = await db
        .select({ sourceOpportunityId: opportunities.sourceOpportunityId })
        .from(opportunities)
        .where(eq(opportunities.id, document.opportunityId))
        .limit(1);
      if (!opportunity?.sourceOpportunityId) {
        throw new SnapshotRetrievalError("missing", "Beacon source solicitation id is unavailable");
      }

      const downloadUrl = resolveBeaconDocumentDownloadUrl({
        sourceOpportunityId: opportunity.sourceOpportunityId,
        sourceDocumentKey: document.sourceDocumentKey,
      });
      if (!downloadUrl) {
        throw new SnapshotRetrievalError("missing", "Beacon document route could not be resolved");
      }

      const cookieHeader = await getCookieHeader();
      const response = await resolveResponse({
        downloadUrl,
        sourceDocumentKey: document.sourceDocumentKey,
        cookieHeader,
        timeoutMs,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        if (
          isBeaconPermissionResponse(response.status, body) ||
          isBeaconRegistrationRequiredResponse(response.status, body)
        ) {
          throw new SnapshotRetrievalError(
            "auth_blocked",
            "Beacon denied the current supplier session access to the pursuit document.",
          );
        }
        if (response.status === 404) {
          throw new SnapshotRetrievalError("missing", "Beacon source document is no longer available");
        }
        throw new SnapshotRetrievalError("http", `Beacon source document returned HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new SnapshotRetrievalError("missing", "Beacon source document returned no body");
      }

      let byteCount = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          byteCount += Buffer.byteLength(chunk);
          if (byteCount > document.maxBytes) {
            callback(new SnapshotRetrievalError("size", "Source document exceeds the pursuit snapshot byte limit"));
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
        mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || document.mimeType,
      };
    },
  };
}
