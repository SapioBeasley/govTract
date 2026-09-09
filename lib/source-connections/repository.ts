import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { sourceConnections } from "@/lib/db/source-connections-schema";
import {
  decryptBrowserSession,
  encryptBrowserSession,
  getBrowserSessionExpiry,
  getSourceSessionEncryptionKey,
  type BrowserSessionEnvelope,
} from "./session";

export type SourceConnectionStatus = "connected" | "needs_reauth" | "disconnected";

export type SourceConnectionErrorCode =
  | "session_missing"
  | "session_expired"
  | "session_invalid"
  | "authentication_failed"
  | "retrieval_unauthorized"
  | "manual_disconnect";

export type SourceConnectionSummary = {
  id: string;
  provider: string;
  accountIdentifier: string | null;
  status: SourceConnectionStatus;
  sessionEnvelopeVersion: number;
  sessionExpiresAt: Date | null;
  connectedAt: Date | null;
  lastValidatedAt: Date | null;
  lastError: SourceConnectionErrorCode | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveSourceConnectionInput = {
  provider: string;
  accountIdentifier?: string | null;
  session: BrowserSessionEnvelope;
  metadata?: Record<string, unknown>;
  validatedAt?: Date;
};

export class SourceConnectionUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: "missing" | "not_connected" | "expired" | "session_missing" | "decrypt_failed",
  ) {
    super(`Source connection unavailable for ${provider}: ${reason}`);
    this.name = "SourceConnectionUnavailableError";
  }
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) throw new Error("Source connection provider is required");
  return normalized;
}

function asStatus(value: string): SourceConnectionStatus {
  if (value === "connected" || value === "needs_reauth" || value === "disconnected") {
    return value;
  }
  throw new Error(`Unsupported source connection status: ${value}`);
}

function asErrorCode(value: string | null): SourceConnectionErrorCode | null {
  if (value === null) return null;
  if (
    value === "session_missing" ||
    value === "session_expired" ||
    value === "session_invalid" ||
    value === "authentication_failed" ||
    value === "retrieval_unauthorized" ||
    value === "manual_disconnect"
  ) {
    return value;
  }
  return null;
}

export async function getSourceConnectionSummary(
  provider: string,
): Promise<SourceConnectionSummary | null> {
  const normalizedProvider = normalizeProvider(provider);
  const db = getDb();
  const [row] = await db
    .select({
      id: sourceConnections.id,
      provider: sourceConnections.provider,
      accountIdentifier: sourceConnections.accountIdentifier,
      status: sourceConnections.status,
      sessionEnvelopeVersion: sourceConnections.sessionEnvelopeVersion,
      sessionExpiresAt: sourceConnections.sessionExpiresAt,
      connectedAt: sourceConnections.connectedAt,
      lastValidatedAt: sourceConnections.lastValidatedAt,
      lastError: sourceConnections.lastError,
      metadata: sourceConnections.metadata,
      createdAt: sourceConnections.createdAt,
      updatedAt: sourceConnections.updatedAt,
    })
    .from(sourceConnections)
    .where(eq(sourceConnections.provider, normalizedProvider))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    status: asStatus(row.status),
    lastError: asErrorCode(row.lastError),
  };
}

export async function saveSourceConnection(
  input: SaveSourceConnectionInput,
): Promise<SourceConnectionSummary> {
  const provider = normalizeProvider(input.provider);
  const now = new Date();
  const validatedAt = input.validatedAt ?? now;
  const sessionExpiresAt = getBrowserSessionExpiry(input.session);
  const encryptedSession = encryptBrowserSession(
    input.session,
    getSourceSessionEncryptionKey(),
  );
  const db = getDb();

  await db
    .insert(sourceConnections)
    .values({
      provider,
      accountIdentifier: input.accountIdentifier?.trim() || null,
      status: "connected",
      sessionEnvelopeVersion: input.session.version,
      encryptedSession,
      sessionExpiresAt,
      connectedAt: now,
      lastValidatedAt: validatedAt,
      lastError: null,
      metadata: input.metadata ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sourceConnections.provider,
      set: {
        accountIdentifier: input.accountIdentifier?.trim() || null,
        status: "connected",
        sessionEnvelopeVersion: input.session.version,
        encryptedSession,
        sessionExpiresAt,
        connectedAt: now,
        lastValidatedAt: validatedAt,
        lastError: null,
        metadata: input.metadata ?? {},
        updatedAt: now,
      },
    });

  const saved = await getSourceConnectionSummary(provider);
  if (!saved) throw new Error(`Failed to persist source connection for ${provider}`);
  return saved;
}

export async function loadSourceConnectionSession(
  provider: string,
): Promise<BrowserSessionEnvelope> {
  const normalizedProvider = normalizeProvider(provider);
  const db = getDb();
  const [row] = await db
    .select({
      status: sourceConnections.status,
      encryptedSession: sourceConnections.encryptedSession,
      sessionExpiresAt: sourceConnections.sessionExpiresAt,
    })
    .from(sourceConnections)
    .where(eq(sourceConnections.provider, normalizedProvider))
    .limit(1);

  if (!row) {
    throw new SourceConnectionUnavailableError(normalizedProvider, "missing");
  }
  if (row.status !== "connected") {
    throw new SourceConnectionUnavailableError(normalizedProvider, "not_connected");
  }
  if (row.sessionExpiresAt && row.sessionExpiresAt.getTime() <= Date.now()) {
    await markSourceConnectionNeedsReauth(normalizedProvider, "session_expired");
    throw new SourceConnectionUnavailableError(normalizedProvider, "expired");
  }
  if (!row.encryptedSession) {
    await markSourceConnectionNeedsReauth(normalizedProvider, "session_missing");
    throw new SourceConnectionUnavailableError(normalizedProvider, "session_missing");
  }

  try {
    return decryptBrowserSession(
      row.encryptedSession,
      getSourceSessionEncryptionKey(),
    );
  } catch {
    await markSourceConnectionNeedsReauth(normalizedProvider, "session_invalid");
    throw new SourceConnectionUnavailableError(normalizedProvider, "decrypt_failed");
  }
}

export async function markSourceConnectionValidated(provider: string): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  await getDb()
    .update(sourceConnections)
    .set({
      status: "connected",
      lastValidatedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(sourceConnections.provider, normalizedProvider));
}

export async function markSourceConnectionNeedsReauth(
  provider: string,
  reason: Exclude<SourceConnectionErrorCode, "manual_disconnect">,
): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  await getDb()
    .update(sourceConnections)
    .set({
      status: "needs_reauth",
      lastError: reason,
      updatedAt: new Date(),
    })
    .where(eq(sourceConnections.provider, normalizedProvider));
}

export async function disconnectSourceConnection(provider: string): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  await getDb()
    .update(sourceConnections)
    .set({
      status: "disconnected",
      encryptedSession: null,
      sessionExpiresAt: null,
      lastError: "manual_disconnect",
      updatedAt: new Date(),
    })
    .where(eq(sourceConnections.provider, normalizedProvider));
}
