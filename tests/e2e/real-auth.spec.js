// ONE end-to-end test against the REAL Supabase project — nothing is stubbed.
//
// It exists to prove the live login flow works the way the site promises:
// a logged-out customer fills the cart, taps "Place order", gets the login
// popup (AUTO_ACCOUNT is false), creates their own account, and comes back to
// a cart that still holds their dish and their details — and stays logged in
// after a reload.
//
// It creates a real auth user, so it is skipped unless E2E_REAL_AUTH=1:
//
//     npm run test:real-auth
//
// Every account it makes uses the e2e+<timestamp>@example.com shape, so
// supabase/cleanup_e2e_users.sql finds them. It never taps the final
// "Place order", so it never writes an order.

const { test, expect } = require('@playwright/test');
const { openCart, expectSignedIn, expectSignedOut } = require('./helpers/fixtures');

// Mirrors `const AUTO_ACCOUNT` at the top of site.js. Keep the two in step:
// this test asserts the login-popup path, which only exists when it is false.
const AUTO_ACCOUNT = false;

const RUN = process.env.E2E_REAL_AUTH === '1';
const SKIP_NOTE =
  'needs the live Supabase project and creates a real test account — run it with E2E_REAL_AUTH=1 (npm run test:real-auth)';

const CUSTOMER_NAME = 'E2E TEST';
const CUSTOMER_PHONE = '08031234567';
const CUSTOMER_ADDRESS = 'E2E TEST — automated Playwright login check, please ignore';

// e2e+20261111-093015-1234567@example.com — unique per run so the live project
// is never asked to reuse an existing email.
function uniqueEmail() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(Math.floor(Math.random() * 1e7), 7)}`;
  return `e2e+${stamp}@example.com`;
}

// A password nobody owns: printed nowhere, and the account is deleted by
// supabase/cleanup_e2e_users.sql.
function strongPassword() {
  return `Eq-E2e!${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

// Everything the site has to say when a step goes wrong, read out of the DOM
// so the failure report shows the customer's own words.
const SITE_MESSAGES = [
  ['login popup reason', '#acctReason'],
  ['login popup message', '#acctMessage'],
  ['cart error', '#cartErrorText'],
  ['cart status line', '#cartStatusLine'],
  ['header greeting', '#navGreetingItem']
];

async function whatTheSiteShowed(page) {
  const lines = [];

  for (const [label, selector] of SITE_MESSAGES) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) continue;
    const visible = await locator.isVisible().catch(() => false);
    const text = (await locator.innerText().catch(() => '')).trim();
    if (text) lines.push(`  ${visible ? '' : '(hidden) '}${label}: "${text}"`);
  }

  const cartLines = await page
    .locator('#cartLines .cart-line-name')
    .allInnerTexts()
    .catch(() => []);
  if (cartLines.length) lines.push(`  cart holds: ${cartLines.map((s) => s.trim()).join(', ')}`);

  for (const id of ['cartName', 'cartPhone', 'cartEmail', 'cartAddress']) {
    const value = await page.locator(`#${id}`).inputValue().catch(() => '');
    lines.push(`  #${id}: ${value ? `"${value}"` : '(empty)'}`);
  }

  return lines;
}

// Collects console errors, page crashes and failing Supabase responses for the
// failure report below. One test, one page, so module scope is enough.
const NOISE = [];

function watchForNoise(page) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      NOISE.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (err) => NOISE.push(`page error: ${err.message}`));
  page.on('requestfailed', (request) => {
    const why = (request.failure() || {}).errorText || 'unknown';
    NOISE.push(`request failed: ${request.method()} ${request.url()} — ${why}`);
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (!/supabase\.co/.test(url) || response.status() < 400) return;
    let body = '';
    try {
      body = (await response.text()).slice(0, 400);
    } catch (err) {
      body = '(body unavailable)';
    }
    NOISE.push(`supabase ${response.status()} ${url}\n      ${body}`);
  });
}

test.beforeEach(async ({ page }) => {
  NOISE.length = 0;
  watchForNoise(page);
});

test.describe('real Supabase login flow', () => {
  test.skip(!RUN, SKIP_NOTE);

  // Any step that fails prints the customer's own view of it plus everything
  // Supabase and the browser complained about.
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped') return;

    const lines = ['--- what the site showed ---'];
    const shown = await whatTheSiteShowed(page).catch((err) => [`  could not read the page: ${err.message}`]);
    lines.push(...shown, '--- supabase / browser noise ---');
    lines.push(...(NOISE.length ? NOISE.map((line) => `  ${line}`) : ['  none captured']));

    const report = lines.join('\n');
    console.log(report);
    await testInfo.attach('site said', { body: report, contentType: 'text/plain' });
  });

  test('a logged-out customer creates an account from the cart and stays logged in', async ({ page }) => {
    // The popup path this test walks only exists while AUTO_ACCOUNT is false.
    test.skip(AUTO_ACCOUNT, 'AUTO_ACCOUNT = true in site.js: checkout opens the account itself, there is no login popup');
    // One real account per run is enough, and the desktop viewport is the
    // simpler one (categories are open, nothing hides behind a hamburger).
    test.skip(test.info().project.name !== 'desktop', 'the desktop project runs the live check');
    // Three real round trips to Supabase, over the public internet.
    test.setTimeout(180000);

    const email = uniqueEmail();
    const password = strongPassword();
    console.log(`E2E real-auth run creating account ${email} (delete with supabase/cleanup_e2e_users.sql)`);

    // 1. The real menu.
    await page.goto('/menu.html');
    await expect(page.locator('#menuContent .menu-card').first()).toBeVisible({ timeout: 60000 });
    await expectSignedOut(page);

    // 2. Add the first dish that is actually available.
    const addBtn = page.locator('.menu-card:not(.menu-card--unavailable) .menu-add-btn').first();
    const dish = await addBtn.getAttribute('data-add-name');
    expect(dish, 'the live menu offered no available dish').toBeTruthy();
    await addBtn.click();

    // 3. Open the cart and fill in the details.
    await openCart(page);
    await page.locator('#cartName').fill(CUSTOMER_NAME);
    await page.locator('#cartPhone').fill(CUSTOMER_PHONE);
    await page.locator('#cartEmail').fill(email);
    await page.locator('#cartAddress').fill(CUSTOMER_ADDRESS);

    // 4. Place order — with AUTO_ACCOUNT false this must ask them to log in,
    //    not silently create anything.
    await page.locator('#cartPlaceBtn').click();
    await expect(page.locator('#acctBox')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#acctReason')).toHaveText(
      'Please log in to place your order. Your cart and details are saved.'
    );
    await expect(page.locator('#cartError')).toBeHidden();

    // 5. Create the account for real.
    await page.locator('#acctTabCreate').click();
    await page.locator('#acctName').fill(CUSTOMER_NAME);
    await page.locator('#acctPhone').fill(CUSTOMER_PHONE);
    await page.locator('#acctEmail').fill(email);
    await page.locator('#acctPassword').fill(password);
    await page.locator('#acctPassword2').fill(password);
    await page.locator('#acctAddress').fill(CUSTOMER_ADDRESS);
    await page.locator('#acctSignupBtn').click();

    try {
      await expect(page.locator('#acctBox')).toBeHidden({ timeout: 60000 });
    } catch (err) {
      // The live project may still ask new accounts to confirm by email, or
      // refuse the signup. Say so in the site's own words instead of timing out.
      const said = (await whatTheSiteShowed(page)).join('\n');
      throw new Error(`Creating ${email} did not sign the customer in. What the site showed:\n${said}\n(${err.message})`);
    }

    // 6. Back to the cart, dish and details intact, header signed in.
    await expect(page.locator('#cartPanel')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#cartLines .cart-line-name').first()).toHaveText(dish);
    await expect(page.locator('#cartName')).toHaveValue(CUSTOMER_NAME);
    await expect(page.locator('#cartEmail')).toHaveValue(email);
    await expect(page.locator('#cartAddress')).toHaveValue(CUSTOMER_ADDRESS);
    await expect(page.locator('#cartError')).toBeHidden();
    await expectSignedIn(page, CUSTOMER_NAME);

    // Deliberately NOT tapping Place order: this test creates no orders.

    // 7. A reload must restore the session from storage — no login prompt.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#menuContent .menu-card').first()).toBeVisible({ timeout: 60000 });
    await expectSignedIn(page, CUSTOMER_NAME);
    await expect(page.locator('#acctBox')).toBeHidden();

    // The cart survived the reload too, so the customer really is back where
    // they left off.
    await openCart(page);
    await expect(page.locator('#cartLines .cart-line-name').first()).toHaveText(dish);
  });
});
