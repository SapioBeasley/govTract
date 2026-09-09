import puppeteer from 'puppeteer';

const LIST_URL = 'https://www.beaconbid.com/solicitations/city-of-houston/open';
const MAX_DETAILS = 20;

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

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 public-procurement-indexer');

  page.on('request', (request) => {
    if (!/beaconbid\.com|amazonaws\.com/i.test(request.url())) return;
    const type = request.resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    const post = request.postData();
    console.log('REQ', request.method(), type, safeUrl(request.url()), post ? post.slice(0, 2500) : '');
  });
  page.on('response', (response) => {
    if (!/beaconbid\.com|amazonaws\.com/i.test(response.url())) return;
    const type = response.request().resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    console.log('RES', response.status(), type, safeUrl(response.url()), response.headers()['content-type'] ?? '');
  });

  const listing = await page.goto(LIST_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('LISTING', listing?.status(), page.url());
  await new Promise((r) => setTimeout(r, 1200));

  const links = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/solicitations/city-of-houston/"]')) {
      const href = a.href;
      if (!seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    }
    return out;
  });
  console.log('DETAIL_LINK_COUNT', links.length);

  let found = false;
  for (const href of links.slice(0, MAX_DETAILS)) {
    console.log('DETAIL_VISIT', href);
    await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 800));

    const requestButton = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button,[role="button"],a'));
      const el = candidates.find((node) => /request documents/i.test((node.textContent ?? '').trim()));
      if (!el) return null;
      return {
        tag: el.tagName,
        text: (el.textContent ?? '').trim(),
        href: el instanceof HTMLAnchorElement ? el.href : null,
        type: el.getAttribute('type'),
        ariaLabel: el.getAttribute('aria-label'),
      };
    });

    if (!requestButton) continue;
    found = true;
    console.log('REQUEST_BUTTON', JSON.stringify(requestButton));

    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button,[role="button"],a'));
      const el = candidates.find((node) => /request documents/i.test((node.textContent ?? '').trim()));
      if (el instanceof HTMLElement) el.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    const modal = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') ??
        Array.from(document.querySelectorAll('div')).find((el) => /request documents/i.test((el.textContent ?? '').trim()) && el.querySelector('input,button'));
      if (!dialog) return null;

      const labels = Array.from(dialog.querySelectorAll('label')).map((el) => (el.textContent ?? '').trim()).filter(Boolean);
      const inputs = Array.from(dialog.querySelectorAll('input,textarea,select')).map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        autocomplete: el.getAttribute('autocomplete'),
        required: el.hasAttribute('required'),
        ariaLabel: el.getAttribute('aria-label'),
      }));
      const buttons = Array.from(dialog.querySelectorAll('button,[role="button"],a')).map((el) => ({
        tag: el.tagName,
        text: (el.textContent ?? '').trim(),
        type: el.getAttribute('type'),
        href: el instanceof HTMLAnchorElement ? el.href : null,
      })).filter((x) => x.text || x.href);
      const forms = Array.from(dialog.querySelectorAll('form')).map((form) => ({
        action: form.getAttribute('action'),
        method: form.getAttribute('method'),
      }));
      return {
        text: (dialog.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 4000),
        labels,
        inputs,
        buttons,
        forms,
        html: dialog.outerHTML.slice(0, 10000),
      };
    });
    console.log('MODAL', JSON.stringify(modal));

    const cookies = await page.cookies();
    console.log('COOKIE_METADATA', JSON.stringify(cookies.map(({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({ name, domain, path, expires, httpOnly, secure, sameSite }))));

    const documentLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/api/planholder/document/"]')).map((a) => a.href));
    console.log('DOCUMENT_LINKS', JSON.stringify(documentLinks));
    break;
  }

  if (!found) {
    console.log('NO_REQUEST_DOCUMENTS_MODAL_FOUND');
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
