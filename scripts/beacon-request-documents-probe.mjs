import puppeteer from 'puppeteer';

const LIST_URL = 'https://www.beaconbid.com/solicitations/city-of-houston/open';
const UUID_PATH = /\/solicitations\/city-of-houston\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

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
    console.log('REQ', request.method(), type, safeUrl(request.url()), post ? post.slice(0, 4000) : '');
  });
  page.on('response', (response) => {
    if (!/beaconbid\.com|amazonaws\.com/i.test(response.url())) return;
    const type = response.request().resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    console.log('RES', response.status(), type, safeUrl(response.url()), response.headers()['content-type'] ?? '');
  });

  await page.goto(LIST_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1000));

  const links = await page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="/solicitations/city-of-houston/"]'))
      .map((a) => a.href)
      .filter((href) => {
        if (!/\/solicitations\/city-of-houston\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i.test(new URL(href).pathname)) return false;
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });
  });
  console.log('DETAIL_LINK_COUNT', links.length);

  const readModal = async () => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') ??
      Array.from(document.querySelectorAll('div')).find((el) => /request documents/i.test((el.textContent ?? '')) && el.querySelector('input,textarea,select,button'));
    if (!dialog) return null;
    return {
      text: (dialog.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 5000),
      labels: Array.from(dialog.querySelectorAll('label')).map((el) => (el.textContent ?? '').trim()).filter(Boolean),
      inputs: Array.from(dialog.querySelectorAll('input,textarea,select')).map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        autocomplete: el.getAttribute('autocomplete'),
        required: el.hasAttribute('required'),
        ariaLabel: el.getAttribute('aria-label'),
      })),
      buttons: Array.from(dialog.querySelectorAll('button,[role="button"],a')).map((el) => ({
        tag: el.tagName,
        text: (el.textContent ?? '').trim(),
        type: el.getAttribute('type'),
        href: el instanceof HTMLAnchorElement ? el.href : null,
      })).filter((x) => x.text || x.href),
      forms: Array.from(dialog.querySelectorAll('form')).map((form) => ({ action: form.getAttribute('action'), method: form.getAttribute('method') })),
      html: dialog.outerHTML.slice(0, 12000),
    };
  });

  let found = false;
  for (const href of links) {
    console.log('DETAIL_VISIT', href);
    await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 700));

    const controls = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"],a')).map((el, index) => ({
      index,
      tag: el.tagName,
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 250),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      ariaLabel: el.getAttribute('aria-label'),
    })).filter((x) => /request documents|download package/i.test(x.text) || (x.href && x.href.includes('/api/planholder/document/'))));
    console.log('DOC_CONTROLS', JSON.stringify(controls.slice(0, 12)));

    const clicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button,[role="button"],a'));
      const ranked = [
        all.find((el) => /request documents/i.test((el.textContent ?? '').trim())),
        all.find((el) => /download package/i.test((el.textContent ?? '').trim())),
        all.find((el) => el instanceof HTMLAnchorElement && el.href.includes('/api/planholder/document/')),
      ].filter(Boolean);
      const el = ranked[0];
      if (!(el instanceof HTMLElement)) return null;
      const info = {
        tag: el.tagName,
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 250),
        href: el instanceof HTMLAnchorElement ? el.href : null,
      };
      el.click();
      return info;
    });

    if (!clicked) continue;
    console.log('CLICKED', JSON.stringify(clicked));
    await new Promise((r) => setTimeout(r, 1500));

    const modal = await readModal();
    console.log('MODAL', JSON.stringify(modal));
    if (!modal) continue;

    const cookies = await page.cookies();
    console.log('COOKIE_METADATA', JSON.stringify(cookies.map(({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({ name, domain, path, expires, httpOnly, secure, sameSite }))));
    found = true;
    break;
  }

  if (!found) console.log('NO_REQUEST_DOCUMENTS_MODAL_FOUND');
} finally {
  await browser.close();
}
