import puppeteer from 'puppeteer';

const DETAIL_URL = 'https://www.beaconbid.com/solicitations/city-of-houston/892d339e-2dcb-4700-8d61-42785a5e0554/industrial-fire-brigade-structural-fire-trainer';
const TERMS = [
  'createPlanholder',
  'RequestDocumentsForm',
  'emailDocument',
  '/api/planholder/document',
  'seen_documents_',
  'Download Package',
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.goto(DETAIL_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => /download package/i.test((el.textContent ?? '').trim()));
    if (!(button instanceof HTMLElement)) throw new Error('Download Package button not found');
    button.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));

  const resources = await page.evaluate(() => {
    const urls = new Set(Array.from(document.scripts).map((s) => s.src).filter(Boolean));
    for (const entry of performance.getEntriesByType('resource')) {
      if (entry.name.includes('.js')) urls.add(entry.name);
    }
    return Array.from(urls);
  });
  console.log('JS_RESOURCE_COUNT', resources.length);
  console.log('JS_RESOURCES', JSON.stringify(resources));

  for (const src of resources) {
    let text;
    try {
      const response = await fetch(src);
      if (!response.ok) continue;
      text = await response.text();
    } catch {
      continue;
    }

    const matched = TERMS.filter((term) => text.includes(term));
    if (!matched.length) continue;
    console.log('MATCHING_BUNDLE', src, JSON.stringify(matched), 'bytes=' + text.length);

    for (const term of matched) {
      let from = 0;
      let hits = 0;
      while (hits < 6) {
        const index = text.indexOf(term, from);
        if (index < 0) break;
        const start = Math.max(0, index - 2500);
        const end = Math.min(text.length, index + term.length + 4500);
        const snippet = text.slice(start, end).replace(/\s+/g, ' ');
        console.log(`SNIPPET term=${term} hit=${hits + 1}`, snippet);
        from = index + term.length;
        hits += 1;
      }
    }
  }
} finally {
  await browser.close();
}
