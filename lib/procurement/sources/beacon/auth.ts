import chromium from "@sparticuz/chromium";
import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
} from "puppeteer-core";

import {
  createBrowserSessionEnvelope,
  type BrowserSessionCookie,
  type BrowserSessionEnvelope,
} from "@/lib/source-connections/session";

const BEACON_ORIGIN = "https://www.beaconbid.com";
const BEACON_HOSTS = new Set(["beaconbid.com", "www.beaconbid.com"]);
const MAGIC_LINK_MAX_LENGTH = 4096;
const AUTH_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149.0 Safari/537.36 govTract/0.1 beacon-connect";

export type BeaconAuthErrorCode =
  | "invalid_magic_link"
  | "browser_unavailable"
  | "authentication_timeout"
  | "authentication_failed"
  | "session_cookie_missing"
  | "session_restore_failed";

export class BeaconAuthError extends Error {
  constructor(
    public readonly code: BeaconAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BeaconAuthError";
  }
}

export type BeaconAuthenticatedSession = {
  role: "supplier";
  accountIdentifier: string | null;
  session: BrowserSessionEnvelope;
};

type SessionProbe = {
  status: number;
  role: string | null;
  accountIdentifier: string | null;
};

export function parseBeaconMagicLink(rawValue: string): URL {
  const value = rawValue.trim();
  if (!value || value.length > MAGIC_LINK_MAX_LENGTH) {
    throw new BeaconAuthError("invalid_magic_link", "Beacon magic link is missing or too long");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BeaconAuthError("invalid_magic_link", "Beacon magic link is not a valid URL");
  }

  if (
    url.protocol !== "https:" ||
    !BEACON_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/login" ||
    url.search
  ) {
    throw new BeaconAuthError("invalid_magic_link", "Beacon magic link has an unexpected target");
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const token = fragment.get("token");
  const eid = fragment.get("eid");

  if (
    fragment.size !== 2 ||
    !token?.startsWith("identity-login.v2.") ||
    token.length > 3000 ||
    !eid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eid)
  ) {
    throw new BeaconAuthError("invalid_magic_link", "Beacon magic link credentials are malformed");
  }

  return url;
}

async function launchBrowser(): Promise<Browser> {
  try {
    chromium.setGraphicsMode = false;
    const executablePath = await chromium.executablePath();
    const args = await puppeteer.defaultArgs({
      args: chromium.args,
      headless: "shell",
    });

    return await puppeteer.launch({
      args,
      executablePath,
      headless: "shell",
      defaultViewport: {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false,
      },
    });
  } catch {
    throw new BeaconAuthError("browser_unavailable", "Beacon authentication browser could not start");
  }
}

async function preparePage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setUserAgent(USER_AGENT);
  return page;
}

async function probeSession(page: Page): Promise<SessionProbe> {
  return page.evaluate(async () => {
    const response = await fetch("/api/rest/session", { credentials: "include" });
    const text = await response.text();
    let body: unknown = null;

    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const role = record && typeof record.role === "string" ? record.role : null;

    function emailFrom(value: unknown): string | null {
      if (!value || typeof value !== "object") return null;
      const email = (value as Record<string, unknown>).email;
      return typeof email === "string" && email.includes("@") ? email : null;
    }

    return {
      status: response.status,
      role,
      accountIdentifier:
        emailFrom(record?.contact) ??
        emailFrom(record?.identity) ??
        emailFrom(record?.supplier) ??
        null,
    };
  });
}

async function waitForSupplierSession(
  page: Page,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<SessionProbe> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = await probeSession(page);
    if (session.status === 200 && session.role === "supplier") return session;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new BeaconAuthError(
    "authentication_timeout",
    "Beacon did not establish a supplier session before the login link expired or timed out",
  );
}

function toSessionCookie(
  cookie: Awaited<ReturnType<BrowserContext["cookies"]>>[number],
): BrowserSessionCookie {
  const sameSite =
    cookie.sameSite === "Strict" || cookie.sameSite === "Lax" || cookie.sameSite === "None"
      ? cookie.sameSite
      : undefined;

  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(sameSite ? { sameSite } : {}),
  };
}

function cookieDomainAllowed(domain: string): boolean {
  const normalized = domain.replace(/^\./, "").toLowerCase();
  return normalized === "www.beaconbid.com" || normalized === "beaconbid.com";
}

async function captureSession(page: Page): Promise<BrowserSessionEnvelope> {
  const cookies = (await page.browserContext().cookies())
    .filter((cookie) => cookieDomainAllowed(cookie.domain))
    .map(toSessionCookie);

  if (!cookies.some((cookie) => cookie.name === "_bs" && cookie.value)) {
    throw new BeaconAuthError(
      "session_cookie_missing",
      "Beacon supplier session did not include the expected authentication cookie",
    );
  }

  let localStorage: Record<string, string> = {};
  try {
    localStorage = await page.evaluate(() => Object.fromEntries(Object.entries(window.localStorage)));
  } catch {
    // The validated Beacon session is cookie-backed. Local storage is optional and was
    // empty in the successful auth probe, so inability to read it must not discard _bs.
  }

  return createBrowserSessionEnvelope(cookies, localStorage);
}

async function restoreSessionInFreshBrowser(
  session: BrowserSessionEnvelope,
): Promise<SessionProbe> {
  const browser = await launchBrowser();

  try {
    const context = browser.defaultBrowserContext();
    await context.setCookie(
      ...session.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        ...(cookie.expires ? { expires: cookie.expires } : {}),
        ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
        ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      })),
    );

    const page = await preparePage(context);
    await page.goto(BEACON_ORIGIN, { waitUntil: "networkidle2", timeout: 45_000 });

    if (session.localStorage && Object.keys(session.localStorage).length > 0) {
      await page.evaluate((values) => {
        window.localStorage.clear();
        for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
      }, session.localStorage);
      await page.reload({ waitUntil: "networkidle2", timeout: 45_000 });
    }

    return await waitForSupplierSession(page, 12_000);
  } catch (error) {
    if (error instanceof BeaconAuthError) throw error;
    throw new BeaconAuthError(
      "session_restore_failed",
      "Beacon session could not be restored into a fresh browser process",
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function authenticateBeaconMagicLink(
  rawMagicLink: string,
): Promise<BeaconAuthenticatedSession> {
  const magicLink = parseBeaconMagicLink(rawMagicLink);
  let initialSession: SessionProbe;
  let session: BrowserSessionEnvelope;

  const browser = await launchBrowser();
  try {
    const context = browser.defaultBrowserContext();
    const page = await preparePage(context);

    try {
      await page.goto(magicLink.toString(), {
        waitUntil: "networkidle2",
        timeout: 45_000,
      });
    } catch {
      throw new BeaconAuthError(
        "authentication_failed",
        "Beacon rejected the login link or the login page could not complete",
      );
    }

    initialSession = await waitForSupplierSession(page);
    session = await captureSession(page);
  } finally {
    await browser.close().catch(() => {});
  }

  const restoredSession = await restoreSessionInFreshBrowser(session);
  if (restoredSession.role !== "supplier") {
    throw new BeaconAuthError(
      "session_restore_failed",
      "Beacon session did not retain supplier access after restoration",
    );
  }

  return {
    role: "supplier",
    accountIdentifier:
      restoredSession.accountIdentifier ?? initialSession.accountIdentifier ?? null,
    session,
  };
}
