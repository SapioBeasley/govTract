import type { BrowserSessionEnvelope } from "@/lib/source-connections/session";

const BEACON_HOSTS = new Set(["beaconbid.com", "www.beaconbid.com"]);

function normalizeDomain(domain: string) {
  return domain.replace(/^\./, "").toLowerCase();
}

function hasUnsafeHeaderCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function responseMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    return [parsed.message, parsed.error]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  } catch {
    return body;
  }
}

export function isBeaconCookieDomain(domain: string) {
  return BEACON_HOSTS.has(normalizeDomain(domain));
}

export function getBeaconSessionCookies(
  session: BrowserSessionEnvelope,
  nowSeconds = Date.now() / 1000,
) {
  return session.cookies.filter((cookie) => {
    if (!isBeaconCookieDomain(cookie.domain)) return false;
    if (cookie.expires && cookie.expires > 0 && cookie.expires <= nowSeconds) return false;
    return true;
  });
}

export function buildBeaconCookieHeader(session: BrowserSessionEnvelope) {
  const cookies = getBeaconSessionCookies(session);
  const authCookie = cookies.find((cookie) => cookie.name === "_bs" && cookie.value);
  if (!authCookie) {
    throw new Error("Beacon session is missing the reusable authentication cookie");
  }

  for (const cookie of cookies) {
    if (
      !cookie.name ||
      hasUnsafeHeaderCharacters(cookie.name) ||
      hasUnsafeHeaderCharacters(cookie.value) ||
      cookie.name.includes(";")
    ) {
      throw new Error("Beacon session contains an invalid cookie");
    }
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function isBeaconRegistrationRequiredResponse(status: number, body: string) {
  if (status !== 400) return false;
  const message = responseMessage(body);
  return /register|registration/i.test(message) && /request/i.test(message);
}

export function isBeaconPermissionResponse(status: number, body: string) {
  if (![400, 401, 403].includes(status)) return false;

  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    if (parsed.code === 103 || parsed.code === "103") return true;
    return (
      typeof parsed.message === "string" &&
      /permission|authori[sz]|planholder|interest list/i.test(parsed.message)
    );
  } catch {
    return /permission|authori[sz]|planholder|interest list/i.test(body);
  }
}

export function parseBeaconSessionProbe(status: number, body: string) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const role = record && typeof record.role === "string" ? record.role : null;

  return {
    status,
    role,
    authenticatedSupplier: status === 200 && role === "supplier",
  };
}
