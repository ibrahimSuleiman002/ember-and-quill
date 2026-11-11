// THE ONLY TEST THAT WRITES TO THE REAL DATABASE.
//
// It is skipped unless you ask for it:
//   Git Bash / CI:  E2E_PLACE_ORDER=1 npx playwright test live-order
//   PowerShell:     $env:E2E_PLACE_ORDER="1"; npx playwright test live-order
//
// Nothing here is stubbed: it signs a brand-new customer up, inserts a real
// order and lands on My orders. The details are deliberately easy to find
// and delete afterwards — the customer name is "E2E TEST" and the email is
// e2e+<timestamp>@example.com, printed in the test output.
//
// This is the automatic-account path, so it needs AUTO_ACCOUNT = true at the
// top of site.js. While that setting is false the test stays skipped even
// with E2E_PLACE_ORDER=1: checkout would show the login popup instead.

const { test, expect } = require('@playwright/test');

// Mirrors site.js — keep the two in step.
const AUTO_ACCOUNT = false;

const CUSTOMER_NAME = 'E2E TEST';
const email = `e2e+${Date.now()}@example.com`;

test('places one real order as a brand new customer', async ({ page }) => {
  test.skip(process.env.E2E_PLACE_ORDER !== '1',
    'set E2E_PLACE_ORDER=1 to run the one test that places a real order');
  test.skip(!AUTO_ACCOUNT,
    'AUTO_ACCOUNT = false in site.js: a first order no longer creates the account');
  test.setTimeout(120000);

  test.info().annotations.push({
    type: 'warning',
    description: `Creates a real account + order for ${email} (name "${CUSTOMER_NAME}"). Delete both afterwards.`
  });

  await page.addInitScript(() => {
    try { localStorage.removeItem('eq_cart_v1'); } catch (err) { /* ignore */ }
  });

  await page.goto('/menu.html');
  const addBtn = page.locator('.menu-card:not(.menu-card--unavailable) .menu-add-btn').first();
  await expect(addBtn).toBeVisible({ timeout: 20000 });
  const dish = await addBtn.getAttribute('data-add-name');
  await addBtn.click();

  await page.locator('#navCart').click();
  await expect(page.locator('#cartPanel')).toHaveClass(/\bopen\b/);

  await page.locator('#cartName').fill(CUSTOMER_NAME);
  await page.locator('#cartPhone').fill('08031234567');
  await page.locator('#cartEmail').fill(email);
  await page.locator('#cartAddress').fill('E2E TEST — automated Playwright order, please ignore');

  await page.locator('#cartPlaceBtn').click();

  const outcome = await Promise.race([
    page.waitForURL(/\/my-orders(\.html)?/, { timeout: 90000 }).then(() => 'placed'),
    page.locator('#cartError').waitFor({ state: 'visible', timeout: 90000 }).then(() => 'refused')
  ]).catch(() => 'timeout');

  expect(outcome, `order did not go through (dish: ${dish})`).toBe('placed');

  // Signed in as the new customer, order at the top, highlighted, with the
  // banner that tells them where their set-password link went.
  await expect(page.locator('#myOrdersBanner')).toBeVisible();
  await expect(page.locator('#myOrdersBannerText')).toContainText(email);
  await expect(page.locator('#myOrdersBannerText')).toContainText('Order placed!');

  const newest = page.locator('[data-new-order="1"]');
  await expect(newest).toHaveCount(1);
  await expect(newest).toHaveClass(/my-order-is-new/);
  await expect(newest).toContainText(dish);

  const orderNo = await newest.locator('.track-card-title').first().textContent().catch(() => null);
  console.log(`E2E order placed for ${email}${orderNo ? ` — order ${orderNo.trim()}` : ''}`);
});
