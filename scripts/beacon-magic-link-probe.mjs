import puppeteer from 'puppeteer';

const BEACON_ORIGIN = 'https://www.beaconbid.com';
const DEFAULT_DETAIL_URL =
  'https://www.beaconbid.com/solicitations/city-of-houston/892d339e-2dcb-4700-8d61-42785a5e0554/industrial-fire-brigade-structural-fire-trainer';
const MAGIC_LINK = process.env.BEACON_MAGIC_LINK?.trim();
const DETAIL_URL = process.env.BEACON_PROBE_DETAIL_URL?.trim() || DEFAULT_DETAIL_URL;
const MAX_PROBE_BYTES = 64 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-auth-probe';

function assertMagicLink(value) {
  if (!value) throw new Error('BEACON_MAGIC_LINK is required');

  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Beacon magic link must use HTTPS');
  if (!['beaconbid.com', 'www.beaconbid.com'].includes(url.hostname)) {
    throw new Error('Beacon magic link has an unexpected host');
  }
  if (url.pathname !== '/login') throw new Error('Beacon magic link must target /login');

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const token = fragment.get('token');
  const eid = fragment.get('eid');
  if (!token?.startsWith('identity-login.')) throw new Error('Beacon magic link token is missing or malformed');
  if (!eid) throw new Error('Beacon magic link eid is missing');

  return url;
}

function assertDetailUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['beaconbid.com', 'www.beaconbid.com'].includes(url.hostname)) {
    throw new Error('Probe detail URL must be an HTTPS beaconbid.com URL');
  }
  if (!url.pathname.startsWith('/solicitations/')) {
    throw new Error('Probe detail URL must be a Beacon solicitation detail page');
  }
  return url;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function preparePage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setUserAgent(USER_AGENT);
  return page;
}

async function fetchSession(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/rest/session', { credentials: 'include' });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      status: response.status,
      role: body && typeof body === 'object' && typeof body.role === 'string' ? body.role : null,
      keys: body && typeof body === 'object' ? Object.keys(body) : [],
    };
  });
}

async function waitForAuthenticatedSession(page, timeoutMs = 30_000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await fetchSession(page);
    if (latest.status === 200 && latest.role && latest.role !== 'guest') return latest;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Beacon session did not authenticate within ${timeoutMs}ms (last role=${latest?.role ?? 'unknown'})`);
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function cookieMetadata(cookies) {
  return cookies.map(({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({
    name,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    sameSite,
  }));
}

function toCookieData(cookie) {
  const result = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
  };
  if (cookie.expires && cookie.expires > 0) result.expires = cookie.expires;
  if (cookie.sameSite) result.sameSite = cookie.sameSite;
  return result;
}

async function captureLocalStorage(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

async function restoreLocalStorage(page, values) {
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, values);
}

async function findIndividualDocument(page) {
  await page.goto(DETAIL_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 750));

  const result = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[href]'))
      .map((element) => ({
        href: element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href'),
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' '),
      }))
      .filter(({ href }) => href && href.includes('/api/planholder/document/'))
      .filter(({ href }) => !/\/zip(?:$|[?#])/.test(href));

    return candidates[0] ?? null;
  });

  if (!result?.href) throw new Error('No individual Beacon document link was found on the authenticated solicitation page');

  const url = new URL(result.href, BEACON_ORIGIN);
  if (url.origin !== BEACON_ORIGIN || !url.pathname.startsWith('/api/planholder/document/')) {
    throw new Error('Discovered document link has an unexpected origin/path');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 5) throw new Error('Discovered document link is missing its document key');
  const solicitationId = parts[3];
  const encodedKey = parts.slice(4).join('/');
  const sourceDocumentKey = decodeURIComponent(encodedKey);

  return {
    url: url.toString(),
    solicitationId,
    sourceDocumentKey,
    label: result.text || sourceDocumentKey.split('/').at(-1) || 'document',
  };
}

function validatePresignedLocation(location, sourceDocumentKey) {
  const url = new URL(location);
  if (url.protocol !== 'https:') throw new Error('Beacon document redirect did not use HTTPS');
  if (url.hostname !== 's3.us-west-2.amazonaws.com') {
    throw new Error(`Beacon document redirect used unexpected host ${url.hostname}`);
  }

  const expectedPath = `/documents.beaconbid.com/${sourceDocumentKey}`;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error('Beacon document redirect path could not be decoded');
  }
  if (decodedPath !== expectedPath) {
    throw new Error('Beacon document redirect did not target the expected bucket/object key');
  }

  for (const required of ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-Signature']) {
    if (!url.searchParams.get(required)) throw new Error(`Beacon document redirect is missing ${required}`);
  }

  return url;
}

async function requestDocumentRoute(document, cookies) {
  const response = await fetch(document.url, {
    redirect: 'manual',
    headers: {
      accept: '*/*',
      cookie: cookieHeader(cookies),
      'user-agent': USER_AGENT,
    },
  });

  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`Beacon document route returned ${response.status} without Location`);
    const signedUrl = validatePresignedLocation(location, document.sourceDocumentKey);
    return {
      kind: 'redirect',
      status: response.status,
      contentType,
      contentLength,
      signedUrl,
    };
  }

  if (!response.ok) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
    } catch {
      body = '';
    }
    throw new Error(`Beacon document route failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  return {
    kind: 'direct',
    status: response.status,
    contentType,
    contentLength,
    response,
  };
}

async function readProbeBytes(response, maxBytes = MAX_PROBE_BYTES) {
  if (!response.body) throw new Error('Document response had no body');
  const reader = response.body.getReader();
  let total = 0;
  const prefix = [];

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const remaining = maxBytes - total;
      const take = Math.min(value.length, remaining);
      for (let i = 0; i < Math.min(take, 8 - prefix.length); i += 1) prefix.push(value[i]);
      total += take;
      if (take < value.length) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return {
    bytesRead: total,
    prefixHex: Buffer.from(prefix).toString('hex'),
  };
}

async function streamDocumentProbe(routeResult) {
  if (routeResult.kind === 'direct') {
    const sample = await readProbeBytes(routeResult.response);
    return {
      source: 'beacon-direct',
      status: routeResult.status,
      contentType: routeResult.contentType,
      contentLength: routeResult.contentLength,
      ...sample,
    };
  }

  const response = await fetch(routeResult.signedUrl, {
    redirect: 'error',
    headers: {
      range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
      'user-agent': USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`S3 document probe failed with HTTP ${response.status}`);

  const sample = await readProbeBytes(response);
  return {
    source: 's3-presigned',
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    contentRange: response.headers.get('content-range'),
    ...sample,
  };
}

assertMagicLink(MAGIC_LINK);
assertDetailUrl(DETAIL_URL);

let browser = await launchBrowser();
let firstSession;
let sessionCookies;
let localStorageValues;
let document;

try {
  const page = await preparePage(browser);
  await page.goto(MAGIC_LINK, { waitUntil: 'networkidle2', timeout: 60_000 });
  firstSession = await waitForAuthenticatedSession(page);
  console.log('AUTH_RESULT', JSON.stringify({ status: firstSession.status, role: firstSession.role, responseKeys: firstSession.keys }));

  sessionCookies = await page.cookies(BEACON_ORIGIN);
  localStorageValues = await captureLocalStorage(page);
  console.log(
    'SESSION_STATE',
    JSON.stringify({
      cookieCount: sessionCookies.length,
      cookies: cookieMetadata(sessionCookies),
      localStorageKeys: Object.keys(localStorageValues),
    }),
  );

  document = await findIndividualDocument(page);
  console.log(
    'DOCUMENT_DISCOVERY',
    JSON.stringify({
      solicitationId: document.solicitationId,
      label: document.label,
      sourceKeyFileName: document.sourceDocumentKey.split('/').at(-1) ?? null,
    }),
  );

  const routeResult = await requestDocumentRoute(document, sessionCookies);
  console.log(
    'DOCUMENT_ROUTE_RESULT',
    JSON.stringify({
      kind: routeResult.kind,
      status: routeResult.status,
      contentType: routeResult.contentType,
      contentLength: routeResult.contentLength,
      presignedRedirectValidated: routeResult.kind === 'redirect',
    }),
  );

  const streamResult = await streamDocumentProbe(routeResult);
  console.log('DOCUMENT_STREAM_RESULT', JSON.stringify(streamResult));
} finally {
  await browser.close();
}

browser = await launchBrowser();
try {
  const context = browser.defaultBrowserContext();
  await context.setCookie(...sessionCookies.map(toCookieData));

  const page = await preparePage(browser);
  await page.goto(BEACON_ORIGIN, { waitUntil: 'networkidle2', timeout: 60_000 });
  await restoreLocalStorage(page, localStorageValues);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });

  const restoredSession = await waitForAuthenticatedSession(page, 15_000);
  const restoredCookies = await page.cookies(BEACON_ORIGIN);
  const restoredRoute = await requestDocumentRoute(document, restoredCookies);

  console.log(
    'RESTORE_RESULT',
    JSON.stringify({
      status: restoredSession.status,
      role: restoredSession.role,
      cookieCount: restoredCookies.length,
      documentRouteKind: restoredRoute.kind,
      documentRouteStatus: restoredRoute.status,
      presignedRedirectValidated: restoredRoute.kind === 'redirect',
    }),
  );
} finally {
  await browser.close();
}
