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
    console.log('REQ', request.method(), request.url(), post ? post.slice(0, 3000) : '');
  });
  page.on('response', (response) => {
    if (!interesting(response.url())) return;
    console.log('RES', response.status(), response.url(), response.headers()['content-type'] ?? '');
  });
  browser.on('targetcreated', (target) => console.log('TARGET', target.type(), target.url()));

  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('PAGE', response?.status(), page.url());
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const candidates = await page.evaluate((needle) => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter((el) => (el.textContent ?? '').trim() === needle)
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent ?? '').trim(),
        href: el instanceof HTMLAnchorElement ? el.href : null,
        role: el.getAttribute('role'),
        className: typeof el.className === 'string' ? el.className : '',
        parentTag: el.parentElement?.tagName ?? null,
        parentHref: el.parentElement instanceof HTMLAnchorElement ? el.parentElement.href : null,
        parentRole: el.parentElement?.getAttribute('role') ?? null,
      }))
      .slice(0, 20);
  }, wanted);
  console.log('CANDIDATES', JSON.stringify(candidates));

  const clicked = await page.evaluate((needle) => {
    const exact = Array.from(document.querySelectorAll('*')).find(
      (el) => (el.textContent ?? '').trim() === needle,
    );
    if (!exact) return { ok: false, reason: 'not-found' };
    let el = exact;
    for (let i = 0; i < 6 && el; i += 1, el = el.parentElement) {
      if (el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement || el.getAttribute('role') === 'button' || typeof el.onclick === 'function') {
        el.click();
        return { ok: true, tag: el.tagName, href: el instanceof HTMLAnchorElement ? el.href : null, role: el.getAttribute('role') };
      }
    }
    exact.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { ok: true, tag: exact.tagName, fallback: true };
  }, wanted);
  console.log('CLICKED', JSON.stringify(clicked));

  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('AFTER', page.url());
} finally {
  await browser.close();
}
