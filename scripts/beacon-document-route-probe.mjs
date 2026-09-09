import puppeteer from 'puppeteer';

const url = 'https://www.beaconbid.com/solicitations/city-of-houston/8cd509cd-03bd-4069-86b0-c0a5ec742d5c/parking-management-system';
const wanted = 'Signed RFP-2026-0014 Parking Management System.pdf';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 public-procurement-indexer');

  const interesting = (u) => /\/api\/|amazonaws|beaconbid\.com/i.test(u);
  page.on('request', (request) => {
    if (!interesting(request.url())) return;
    const post = request.postData();
    console.log('REQ', request.method(), request.url(), post ? post.slice(0, 5000) : '');
  });
  page.on('response', (response) => {
    if (!interesting(response.url())) return;
    console.log('RES', response.status(), response.url(), response.headers()['content-type'] ?? '');
  });
  browser.on('targetcreated', (target) => console.log('TARGET', target.type(), target.url()));

  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('PAGE', response?.status(), page.url());
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const structure = await page.evaluate((needle) => {
    const exact = Array.from(document.querySelectorAll('*')).find(
      (el) => (el.textContent ?? '').trim() === needle,
    );
    if (!exact) return { found: false };
    const ancestors = [];
    let el = exact;
    for (let i = 0; i < 10 && el; i += 1, el = el.parentElement) {
      const controls = Array.from(el.querySelectorAll('button,a,[role="button"]')).map((control) => ({
        tag: control.tagName,
        text: (control.textContent ?? '').trim().slice(0, 200),
        title: control.getAttribute('title'),
        ariaLabel: control.getAttribute('aria-label'),
        href: control instanceof HTMLAnchorElement ? control.href : null,
        className: typeof control.className === 'string' ? control.className : '',
      }));
      ancestors.push({
        depth: i,
        tag: el.tagName,
        className: typeof el.className === 'string' ? el.className : '',
        role: el.getAttribute('role'),
        controls: controls.slice(0, 10),
        html: el.outerHTML.slice(0, 1800),
      });
    }
    return { found: true, ancestors };
  }, wanted);
  console.log('STRUCTURE', JSON.stringify(structure));

  const clicked = await page.evaluate((needle) => {
    const exact = Array.from(document.querySelectorAll('*')).find(
      (el) => (el.textContent ?? '').trim() === needle,
    );
    if (!exact) return { ok: false, reason: 'not-found' };
    let el = exact;
    for (let i = 0; i < 10 && el; i += 1, el = el.parentElement) {
      const controls = Array.from(el.querySelectorAll('button,a,[role="button"]'));
      if (!controls.length) continue;
      const preferred = controls.find((control) =>
        /download|open|view|document|file/i.test([
          control.getAttribute('aria-label') ?? '',
          control.getAttribute('title') ?? '',
          control.textContent ?? '',
        ].join(' ')),
      ) ?? controls[0];
      preferred.click();
      return {
        ok: true,
        depth: i,
        tag: preferred.tagName,
        text: (preferred.textContent ?? '').trim(),
        title: preferred.getAttribute('title'),
        ariaLabel: preferred.getAttribute('aria-label'),
        href: preferred instanceof HTMLAnchorElement ? preferred.href : null,
      };
    }
    exact.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { ok: true, fallback: true, tag: exact.tagName };
  }, wanted);
  console.log('CLICKED', JSON.stringify(clicked));

  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('AFTER', page.url());
} finally {
  await browser.close();
}
