import puppeteer from 'puppeteer';

const ZIP_URL = 'https://www.beaconbid.com/api/planholder/document/07a8b0a3-573e-4247-9250-609f72a57125/zip';
const DETAIL_URL = 'https://www.beaconbid.com/solicitations/city-of-houston/07a8b0a3-573e-4247-9250-609f72a57125';

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/x-amz-|token|signature|credential|security/i.test(key)) u.searchParams.set(key, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

async function inspectFetch(label, url, options = {}) {
  try {
    const response = await fetch(url, { redirect: 'manual', ...options });
    const headers = Object.fromEntries([...response.headers.entries()].filter(([key]) => /^(location|content-type|content-length|content-disposition|set-cookie)$/i.test(key)));
    let preview = '';
    if (response.status >= 400 || (response.headers.get('content-type') ?? '').includes('json') || (response.headers.get('content-type') ?? '').includes('text')) {
      preview = (await response.text()).slice(0, 1000).replace(/\s+/g, ' ');
    }
    console.log(label, JSON.stringify({ status: response.status, url: safeUrl(response.url), headers: { ...headers, location: headers.location ? safeUrl(headers.location) : undefined }, preview }));
    return response;
  } catch (error) {
    console.log(label, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

await inspectFetch('PLAIN_ZIP', ZIP_URL);
await inspectFetch('PLAIN_DETAIL', DETAIL_URL);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 public-procurement-indexer');

  const seen = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/planholder/document/') && !/amazonaws\.com|s3\./i.test(url)) return;
    const h = response.headers();
    seen.push({
      status: response.status(),
      url: safeUrl(url),
      contentType: h['content-type'] ?? null,
      contentLength: h['content-length'] ?? null,
      disposition: h['content-disposition'] ?? null,
      location: h.location ? safeUrl(h.location) : null,
    });
  });

  await page.goto(DETAIL_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  const cookies = await page.cookies();
  console.log('FRESH_BROWSER_COOKIES', JSON.stringify(cookies.map(({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({ name, domain, path, expires, httpOnly, secure, sameSite }))));

  const browserResult = await page.evaluate(async (zipUrl) => {
    try {
      const response = await fetch(zipUrl, { redirect: 'manual' });
      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');
      const disposition = response.headers.get('content-disposition');
      const location = response.headers.get('location');
      let preview = '';
      if (response.status >= 400 || (contentType ?? '').includes('json') || (contentType ?? '').includes('text')) {
        preview = (await response.text()).slice(0, 1000).replace(/\s+/g, ' ');
      }
      return { status: response.status, type: response.type, url: response.url, redirected: response.redirected, contentType, contentLength, disposition, location, preview };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, ZIP_URL);
  if (browserResult && typeof browserResult === 'object' && 'location' in browserResult && browserResult.location) browserResult.location = safeUrl(browserResult.location);
  if (browserResult && typeof browserResult === 'object' && 'url' in browserResult && browserResult.url) browserResult.url = safeUrl(browserResult.url);
  console.log('BROWSER_FETCH_ZIP', JSON.stringify(browserResult));

  const navPage = await browser.newPage();
  let navStatus = null;
  let navUrl = null;
  let navError = null;
  try {
    const response = await navPage.goto(ZIP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    navStatus = response?.status() ?? null;
    navUrl = safeUrl(navPage.url());
  } catch (error) {
    navError = error instanceof Error ? error.message : String(error);
    navUrl = safeUrl(navPage.url());
  }
  console.log('BROWSER_NAV_ZIP', JSON.stringify({ status: navStatus, url: navUrl, error: navError }));
  console.log('SEEN_PACKAGE_RESPONSES', JSON.stringify(seen));
} finally {
  await browser.close();
}
