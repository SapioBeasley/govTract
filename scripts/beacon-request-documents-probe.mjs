import puppeteer from 'puppeteer';

const DETAIL_URL = 'https://www.beaconbid.com/solicitations/city-of-houston/892d339e-2dcb-4700-8d61-42785a5e0554/industrial-fire-brigade-structural-fire-trainer';

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

  await page.goto(DETAIL_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => /download package/i.test((el.textContent ?? '').trim()));
    if (!(button instanceof HTMLElement)) throw new Error('Download Package button not found');
    button.setAttribute('data-govtract-download-package', 'true');
  });
  await page.click('[data-govtract-download-package="true"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

  const fill = async (label, value) => {
    const selector = `input[aria-label="${label}"]`;
    await page.focus(selector);
    await page.keyboard.type(value);
  };
  await fill('First Name', 'govTract');
  await fill('Last Name', 'Probe');
  await fill('Company', 'govTract Probe');
  await fill('Email address', 'govtract-probe@example.com');
  await fill('Phone', '5555550100');

  async function chooseFirst(buttonText, marker) {
    await page.evaluate(({ text, marker }) => {
      const dialog = document.querySelector('[role="dialog"]');
      const button = dialog && Array.from(dialog.querySelectorAll('button')).find((el) => (el.textContent ?? '').includes(text));
      if (!(button instanceof HTMLElement)) throw new Error(`Dropdown button not found: ${text}`);
      button.setAttribute('data-govtract-dropdown', marker);
    }, { text: buttonText, marker });

    await page.click(`[data-govtract-dropdown="${marker}"]`);
    await page.waitForSelector('[role="option"]', { visible: true, timeout: 3000 });
    const options = await page.$$eval('[role="option"]', (els) => els.map((el) => ({
      text: (el.textContent ?? '').trim(),
      ariaSelected: el.getAttribute('aria-selected'),
      ariaDisabled: el.getAttribute('aria-disabled'),
      role: el.getAttribute('role'),
    })).filter((x) => x.text));
    console.log('OPTIONS', buttonText, JSON.stringify(options.slice(0, 12)));

    const handles = await page.$$('[role="option"]');
    if (!handles.length) throw new Error(`No selectable option found for ${buttonText}`);
    await handles[0].click();
    await new Promise((r) => setTimeout(r, 350));

    const selected = await page.$eval(`[data-govtract-dropdown="${marker}"]`, (el) => (el.textContent ?? '').trim().replace(/\s+/g, ' '));
    console.log('SELECTED', buttonText, JSON.stringify(selected));
    if (selected.includes(buttonText)) throw new Error(`Selection did not commit for ${buttonText}`);
  }

  await chooseFirst('Select your location', 'location');
  await chooseFirst('Select your interest', 'interest');

  const checkboxes = await page.$$('[role="dialog"] button[role="checkbox"]');
  if (!checkboxes.length) throw new Error('Consent checkbox not found');
  await checkboxes.at(-1).click();
  await new Promise((r) => setTimeout(r, 300));

  const state = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const submit = dialog && Array.from(dialog.querySelectorAll('button')).find((el) => (el.textContent ?? '').trim() === 'Submit');
    const checks = dialog ? Array.from(dialog.querySelectorAll('button[role="checkbox"]')).map((el) => ({
      checked: el.getAttribute('aria-checked'),
      state: el.getAttribute('data-state'),
    })) : [];
    return {
      submitDisabled: submit instanceof HTMLButtonElement ? submit.disabled : null,
      submitClass: submit?.className ?? null,
      checks,
      selectedText: dialog ? (dialog.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 1500) : null,
    };
  });
  console.log('FORM_STATE', JSON.stringify(state));

  let captured = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    const isBeaconMutation = /www\.beaconbid\.com\/api\//i.test(url) && !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isBeaconMutation) {
      const postData = request.postData() ?? '';
      captured = { method, url: safeUrl(url), postData };
      console.log('BLOCKED_SUBMIT_REQUEST', method, safeUrl(url), postData.slice(0, 12000));
      void request.abort('blockedbyclient');
      return;
    }
    void request.continue();
  });

  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const submit = dialog && Array.from(dialog.querySelectorAll('button')).find((el) => (el.textContent ?? '').trim() === 'Submit');
    if (!(submit instanceof HTMLButtonElement)) throw new Error('Submit button not found');
    if (submit.disabled) throw new Error('Submit remained disabled after synthetic form completion');
    submit.setAttribute('data-govtract-submit', 'true');
  });
  await page.click('[data-govtract-submit="true"]');
  await new Promise((r) => setTimeout(r, 1500));

  console.log('CAPTURED', JSON.stringify(captured));
  if (!captured) process.exitCode = 2;
} finally {
  await browser.close();
}
