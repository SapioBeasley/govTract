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
    const handles = await page.$$('[role="option"]');
    if (!handles.length) throw new Error(`No selectable option found for ${buttonText}`);
    await handles[0].click();
    await new Promise((r) => setTimeout(r, 300));
  }

  await chooseFirst('Select your location', 'location');
  await chooseFirst('Select your interest', 'interest');
  const checkboxes = await page.$$('[role="dialog"] button[role="checkbox"]');
  if (!checkboxes.length) throw new Error('Consent checkbox not found');
  await checkboxes.at(-1).click();
  await new Promise((r) => setTimeout(r, 300));

  const followUpRequests = [];
  let mutationCaptured = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    const postData = request.postData() ?? '';

    if (url.includes('/api/gql?operation=createPlanholder')) {
      mutationCaptured = { method, url: safeUrl(url), postData };
      console.log('MOCKED_CREATE_PLANHOLDER', method, safeUrl(url), postData.slice(0, 12000));
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            createPlanholder: {
              supplier: {
                id: '00000000-0000-4000-8000-000000000001',
                __typename: 'Supplier',
              },
              __typename: 'SolicitationRegistration',
            },
          },
        }),
      });
      return;
    }

    const interestingFollowUp = /\/api\/planholder\/|amazonaws\.com|operation=.*planholder|operation=.*document/i.test(url);
    if (interestingFollowUp) {
      followUpRequests.push({ method, url: safeUrl(url), postData: postData.slice(0, 4000) });
      console.log('FOLLOW_UP_REQUEST', method, safeUrl(url), postData.slice(0, 4000));
    }

    const isOtherBeaconWrite = /www\.beaconbid\.com\/api\//i.test(url) && !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isOtherBeaconWrite) {
      console.log('BLOCKED_OTHER_WRITE', method, safeUrl(url), postData.slice(0, 4000));
      void request.abort('blockedbyclient');
      return;
    }

    void request.continue();
  });

  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const submit = dialog && Array.from(dialog.querySelectorAll('button')).find((el) => (el.textContent ?? '').trim() === 'Submit');
    if (!(submit instanceof HTMLButtonElement)) throw new Error('Submit button not found');
    if (submit.disabled) throw new Error('Submit remained disabled');
    submit.setAttribute('data-govtract-submit', 'true');
  });
  await page.click('[data-govtract-submit="true"]');
  await new Promise((r) => setTimeout(r, 3000));

  const browserState = await page.evaluate(() => ({
    url: location.href,
    dialogPresent: Boolean(document.querySelector('[role="dialog"]')),
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
    bodyText: (document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 1500),
  }));
  const cookies = await page.cookies();
  console.log('BROWSER_STATE', JSON.stringify(browserState));
  console.log('COOKIE_METADATA', JSON.stringify(cookies.map(({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({ name, domain, path, expires, httpOnly, secure, sameSite }))));
  console.log('FOLLOW_UP_SUMMARY', JSON.stringify(followUpRequests));
  console.log('MUTATION_CAPTURED', Boolean(mutationCaptured));
} finally {
  await browser.close();
}
