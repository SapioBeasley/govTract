import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const SESSION_AAD = Buffer.from("govtract:source-session:v1", "utf8");
const SESSION_ALGORITHM = "aes-256-gcm";
const SESSION_ENVELOPE_VERSION = 1 as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type BrowserCookieSameSite = "Strict" | "Lax" | "None";

export type BrowserSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: BrowserCookieSameSite;
};

export type BrowserSessionEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  cookies: BrowserSessionCookie[];
  localStorage?: Record<string, string>;
};

type EncryptedBrowserSession = {
  version: typeof SESSION_ENVELOPE_VERSION;
  algorithm: "A256GCM";
  iv: string;
  authTag: string;
  ciphertext: string;
};

function decodeEncryptionKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  let key: Buffer;

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      "SOURCE_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex characters)",
    );
  }

  return key;
}

function assertBrowserSessionEnvelope(value: unknown): asserts value is BrowserSessionEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid browser session envelope");
  }

  const envelope = value as Partial<BrowserSessionEnvelope>;
  if (envelope.version !== SESSION_ENVELOPE_VERSION || !Array.isArray(envelope.cookies)) {
    throw new Error("Unsupported browser session envelope version");
  }

  for (const cookie of envelope.cookies) {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      typeof cookie.name !== "string" ||
      typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" ||
      typeof cookie.path !== "string"
    ) {
      throw new Error("Invalid cookie in browser session envelope");
    }
  }

  if (
    envelope.localStorage !== undefined &&
    (!envelope.localStorage || typeof envelope.localStorage !== "object" || Array.isArray(envelope.localStorage))
  ) {
    throw new Error("Invalid localStorage state in browser session envelope");
  }
}

export function getSourceSessionEncryptionKey(): string {
  const key = process.env.SOURCE_SESSION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("SOURCE_SESSION_ENCRYPTION_KEY is required for source session persistence");
  }
  return key;
}

export function encryptBrowserSession(
  session: BrowserSessionEnvelope,
  rawKey: string,
): string {
  assertBrowserSessionEnvelope(session);

  const key = decodeEncryptionKey(rawKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(SESSION_ALGORITHM, key, iv);
  cipher.setAAD(SESSION_AAD);

  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedBrowserSession = {
    version: SESSION_ENVELOPE_VERSION,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptBrowserSession(
  encrypted: string,
  rawKey: string,
): BrowserSessionEnvelope {
  const key = decodeEncryptionKey(rawKey);
  const parsed = JSON.parse(encrypted) as Partial<EncryptedBrowserSession>;

  if (
    parsed.version !== SESSION_ENVELOPE_VERSION ||
    parsed.algorithm !== "A256GCM" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.authTag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("Unsupported encrypted browser session payload");
  }

  const decipher = createDecipheriv(
    SESSION_ALGORITHM,
    key,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAAD(SESSION_AAD);
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);
  const session = JSON.parse(plaintext.toString("utf8")) as unknown;
  assertBrowserSessionEnvelope(session);
  return session;
}

export function getBrowserSessionExpiry(session: BrowserSessionEnvelope): Date | null {
  assertBrowserSessionEnvelope(session);

  const expirations = session.cookies
    .map((cookie) => cookie.expires)
    .filter((expires): expires is number =>
      typeof expires === "number" && Number.isFinite(expires) && expires > 0,
    );

  if (expirations.length === 0) return null;
  return new Date(Math.min(...expirations) * 1000);
}

export function createBrowserSessionEnvelope(
  cookies: BrowserSessionCookie[],
  localStorage?: Record<string, string>,
): BrowserSessionEnvelope {
  const envelope: BrowserSessionEnvelope = {
    version: SESSION_ENVELOPE_VERSION,
    cookies,
    ...(localStorage && Object.keys(localStorage).length > 0 ? { localStorage } : {}),
  };
  assertBrowserSessionEnvelope(envelope);
  return envelope;
}
