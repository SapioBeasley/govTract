import type { BrowserSessionEnvelope } from "@/lib/source-connections/session";

const BEACON_HOSTS = new Set(["beaconbid.com", "www.beaconbid.com"]);

export interface BeaconRegistrationProfile {
  name: string;
  email: string;
  phone: string;
  position: string;
  regionId: string;
  companyName: string;
  companyRegionId: string;
  specialDesignations: string[];
}

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

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export function parseBeaconRegistrationProfile(body: string): BeaconRegistrationProfile | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const root = objectValue(parsed);
  const contact = objectValue(root?.contact);
  const contactLocation = objectValue(contact?.location);
  const company = objectValue(root?.company);
  const companyLocation = objectValue(company?.location);

  const name = stringValue(contact?.name);
  const email = stringValue(contact?.email);
  const phone = stringValue(contact?.phone);
  const regionId = stringValue(contactLocation?.regionId);
  const companyName = stringValue(company?.name);
  const companyRegionId = stringValue(companyLocation?.regionId);

  if (!name || !email || !phone || !regionId || !companyName || !companyRegionId) {
    return null;
  }

  const specialDesignations = Array.isArray(company?.specialDesignations)
    ? company.specialDesignations.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];

  return {
    name,
    email,
    phone,
    position: stringValue(contact?.position) ?? "",
    regionId,
    companyName,
    companyRegionId,
    specialDesignations,
  };
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
