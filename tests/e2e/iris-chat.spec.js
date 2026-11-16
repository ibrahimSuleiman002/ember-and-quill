// Floating "Chat with Iris" button on the customer pages.
//
// Everything here is local: the menu read is the shared fixture, so the suite
// never writes to the live project. The one exception is the iframe test, and
// it invents its own Iris page with page.route — no request ever leaves this
// machine. site.js is served with IRIS_CHAT_URL swapped for that invented
// address, because the real constant is still the placeholder.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { gotoStubbed, openCart, addToCart, SUYA } = require('./helpers/fixtures');

const PLACEHOLDER = 'PASTE_IRIS_URL_HERE';
const IRIS_TEST_URL = 'https://iris.example.test/chat';
const SITE_JS = path.join(__dirname, '..', '..', 'site.js');

// Read the setting rather than assume it: once the real address is pasted
// into site.js the "not connected" branch no longer exists to test, and the
// "connected" branch needs no patching.
function irisSetting() {
  const source = fs.readFileSync(SITE_JS, 'utf8');
  const value = (source.match(/const IRIS_CHAT_URL\s*=\s*['"]([^'"]*)['"]/) || [])[1];
  return { source, url: value || '', isPlaceholder: !value || value === PLACEHOLDER };
}

const CUSTOMER_PAGES = [
  '/index.html',
  '/menu.html',
  '/order.html',
  '/my-orders.html'
];

// Serve site.js, with the placeholder replaced by a local test address when
// site.js still has the placeholder, and answer that address with a stub page
// so the panel has something real to load. Nothing here leaves the machine.
async function siteWithRealIrisUrl(page) {
  const { source, url, isPlaceholder } = irisSetting();
  const served = isPlaceholder
    ? source.replace(`'${PLACEHOLDER}'`, `'${IRIS_TEST_URL}'`)
    : source;
  const irisUrl = isPlaceholder ? IRIS_TEST_URL : url;

  await page.route('**/site.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: served }));
  await page.route(irisUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><h1>Iris test page</h1></body></html>'
    }));
  return irisUrl;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
         a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe('customer site: floating Iris chat', () => {
  // Google's fonts and the Unsplash hero photo are not part of what these
  // tests check, and either can take 20s+ on a slow connection — which is
  // what makes the suite intermittent. Answer both locally.
  test.beforeEach(async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/images\.unsplash\.com/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from(
          'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
      }));
  });

  test('the button is on every customer page', async ({ page }) => {
    for (const target of CUSTOMER_PAGES) {
      await gotoStubbed(page, target);
      const fab = page.getByRole('button', { name: 'Chat with Iris' });
      await expect(fab, `missing on ${target}`).toBeVisible();
      await expect(fab).toContainText('Chat with Iris');
    }
  });

  test('the admin dashboard has no Iris button', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page.locator('#loginView')).toBeVisible();
    await expect(page.locator('#irisFab')).toHaveCount(0);
    await expect(page.locator('#irisChat')).toHaveCount(0);
  });

  test('pressing it opens the panel, closing it puts the button back', async ({ page }) => {
    await gotoStubbed(page, '/menu.html');

    const fab = page.getByRole('button', { name: 'Chat with Iris' });
    const panel = page.locator('#irisChat');

    await expect(panel).toBeHidden();
    await expect(fab).toHaveAttribute('aria-expanded', 'false');

    await fab.click();
    await expect(panel).toBeVisible();
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.locator('.iris-chat-title')).toHaveText('Iris');

    await panel.locator('#irisChatClose').click();
    await expect(panel).toBeHidden();
    await expect(fab).toHaveAttribute('aria-expanded', 'false');

    // The same button toggles, and Escape gets out of the panel.
    await fab.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('while the address is a placeholder the panel says Iris is not connected', async ({ page }) => {
    test.skip(!irisSetting().isPlaceholder,
      'IRIS_CHAT_URL in site.js is a real address, so there is no placeholder to show');

    await gotoStubbed(page, '/menu.html');
    await page.getByRole('button', { name: 'Chat with Iris' }).click();

    const panel = page.locator('#irisChat');
    await expect(panel.locator('#irisChatOff')).toHaveText('Iris is not connected yet');
    await expect(panel.locator('#irisChatOff')).toBeVisible();
    // No empty frame, and no link that would open a broken address.
    await expect(panel.locator('iframe')).toHaveCount(0);
    await expect(panel.locator('#irisChatOpen')).toBeHidden();
  });

  test('with a real address the panel loads it and offers the new tab', async ({ page }) => {
    const irisUrl = await siteWithRealIrisUrl(page);
    await gotoStubbed(page, '/menu.html');

    await page.getByRole('button', { name: 'Chat with Iris' }).click();
    const panel = page.locator('#irisChat');
    await expect(panel).toBeVisible();

    const frame = panel.locator('.iris-chat-iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', irisUrl);
    await expect(page.frameLocator('.iris-chat-iframe').locator('h1'))
      .toHaveText('Iris test page');

    await expect(panel.locator('#irisChatOff')).toBeHidden();
    const link = panel.locator('#irisChatOpen');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', irisUrl);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('the button never sits on top of the cart', async ({ page }) => {
    const size = page.viewportSize();
    await gotoStubbed(page, '/menu.html');
    await addToCart(page, SUYA);

    const fab = page.getByRole('button', { name: 'Chat with Iris' });
    await expect(fab).toBeVisible();

    // On a phone the sticky "View cart & place order" bar occupies the bottom
    // of the screen; the button has to clear it.
    if (size.width <= 767) {
      const sticky = page.locator('#cartStickyBar');
      await expect(sticky).toBeVisible();
      const fabBox = await fab.boundingBox();
      const barBox = await sticky.boundingBox();
      expect(overlaps(fabBox, barBox), 'the Iris button overlaps the cart bar').toBe(false);

      // Nothing hangs off the screen either.
      expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(size.height + 1);
      expect(fabBox.x + fabBox.width).toBeLessThanOrEqual(size.width + 1);
    }

    // The cart drawer owns the right-hand side, so the button steps aside
    // while it is open and comes back after.
    await openCart(page);
    await expect(fab).toBeHidden();
    await expect(page.locator('#irisChat')).toBeHidden();

    await page.locator('#cartPanelClose').click();
    await expect(fab).toBeVisible();

    // And an open panel stays inside the viewport with no sideways scroll.
    await fab.click();
    await expect(page.locator('#irisChat')).toBeVisible();
    const scroll = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
  });
});
