// Adding a dish, the cart badge, the checkout panel and the login popup a
// logged-out customer gets instead of an order. Supabase is stubbed —
// nothing is written.

const { test, expect } = require('@playwright/test');
const {
  RIBYEYE,
  SUYA,
  JOLLOF,
  CHEESECAKE,
  gotoStubbed,
  openCart,
  addToCart,
  openAllCategories,
  expectNoScrollInsidePanel,
  expectInsideViewport
} = require('./helpers/fixtures');

const DETAILS = {
  cartName: 'Ada Obi',
  cartPhone: '08031234567',
  cartEmail: 'ada@example.com',
  cartAddress: '12 Ember Lane, Wuse II, Abuja'
};

// Each test gets its own browser context, so the cart always starts empty —
// clearing localStorage here would also wipe it on the next navigation.
test.beforeEach(async ({ page }) => {
  await gotoStubbed(page, '/menu.html');
  await expect(page.locator('#menuContent .menu-category').first()).toBeVisible();
});

test('tapping Add confirms on the button, in the badge and in a toast', async ({ page }) => {
  const button = page.locator(`.menu-add-btn[data-add-name="${RIBYEYE}"]`);
  const badge = page.locator('#navCartBadge');

  // Nothing in the cart: no badge at all, not a "0".
  await expect(badge).toBeHidden();

  await button.click();

  await expect(button).toHaveText('✓ Added to cart');
  await expect(button).toHaveClass(/menu-add-btn--added/);

  const toast = page.locator('#cartToast');
  await expect(toast).toBeVisible({ timeout: 1500 });
  await expect(page.locator('#cartToastText')).toHaveText(`${RIBYEYE} added to cart`, { timeout: 1500 });

  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');
  expect(await page.evaluate(() => window.eqCart.count())).toBe(1);

  // About 1.5s later the confirmation gives way to the −/+ stepper.
  await expect(button).toHaveCount(0, { timeout: 4000 });
  const stepper = page.locator(`.qty-stepper .qty-value[data-item-name="${RIBYEYE}"]`);
  await expect(stepper).toBeVisible();
  await expect(stepper).toHaveText('1');

  // The stepper keeps counting.
  await page.locator(`.qty-stepper button[data-action="plus"][data-item-name="${RIBYEYE}"]`).click();
  await expect(badge).toHaveText('2');
  expect(await page.evaluate(() => window.eqCart.count())).toBe(2);

  // And it disappears again once the cart is emptied.
  await page.evaluate(() => window.eqCart.clear());
  await expect(badge).toBeHidden();
});

test('the cart icon opens a checkout panel with the dish, the details form and Place order', async ({ page }) => {
  await addToCart(page, RIBYEYE);
  await openCart(page);

  await expect(page.locator('#cartPanel')).toHaveAttribute('aria-hidden', 'false');

  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);

  await expect(page.locator('.cart-details-title')).toHaveText('Your details');
  for (const id of Object.keys(DETAILS)) {
    await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
    await expect(page.locator(`#${id}`)).toBeVisible();
  }

  const place = page.locator('#cartPlaceBtn');
  await expect(place).toBeVisible();
  await expect(place).toContainText('Place order');
  await expect(page.locator('#cartPanelTotal')).toHaveText('₦18,500');

  // Everything the customer needs, without scrolling the panel.
  await expectNoScrollInsidePanel(page, page.locator('#cartName'));
  await expectNoScrollInsidePanel(page, page.locator('#cartPhone'));
  await expectNoScrollInsidePanel(page, page.locator('#cartEmail'));
  await expectNoScrollInsidePanel(page, page.locator('#cartAddress'));
  await expectInsideViewport(page, place);
});

test('two dishes still leave the whole details form on screen', async ({ page }) => {
  await addToCart(page, RIBYEYE);
  await addToCart(page, SUYA);
  await openCart(page);

  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE, SUYA]);
  await expect(page.locator('#cartPanelTotal')).toHaveText('₦32,500');
  await expect(page.locator('#cartPlaceBtn')).toContainText('₦32,500');

  // The panel gets tight on a phone: every field plus Place order, no scrolling.
  for (const id of Object.keys(DETAILS)) {
    await expectNoScrollInsidePanel(page, page.locator(`#${id}`));
  }
  await expectInsideViewport(page, page.locator('#cartPlaceBtn'));
});

test('a long order scrolls inside the panel and never moves the Place order bar', async ({ page }) => {
  await openAllCategories(page);
  for (const dish of [RIBYEYE, SUYA, JOLLOF, CHEESECAKE]) await addToCart(page, dish);
  await openCart(page);

  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE, SUYA, JOLLOF, CHEESECAKE]);

  const body = page.locator('#cartPanelBody');
  const address = page.locator('#cartAddress');
  const place = page.locator('#cartPlaceBtn');

  const box = await body.boundingBox();
  const metric = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(metric.sh, 'a four-dish order must fit by scrolling, not be clipped').toBeGreaterThan(metric.ch);
  expect(await address.boundingBox()).not.toBeNull();

  const placeBefore = await place.boundingBox();

  // Nothing may be stranded out of reach: the last field scrolls fully into
  // the panel, and the Place order bar does not budge.
  await address.scrollIntoViewIfNeeded();
  const after = await address.boundingBox();
  expect(after.y).toBeGreaterThanOrEqual(box.y - 1);
  expect(after.y + after.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect((await place.boundingBox()).y).toBeCloseTo(placeBefore.y, 0);
  await expectInsideViewport(page, place);
  await expect(address).toBeEditable();
});

test('the checkout panel shows an empty-cart message and hides the form until a dish is added', async ({ page }) => {
  await openCart(page);
  await expect(page.locator('.cart-empty')).toContainText('Your cart is empty');
  await expect(page.locator('#cartDetails')).toBeHidden();
  await expect(page.locator('#cartPlaceBtn')).toBeHidden();

  await page.locator('#cartPanelClose').click();
  await expect(page.locator('#cartPanel')).not.toHaveClass(/\bopen\b/);
});

test('no page anywhere offers "Continue to order"', async ({ page }) => {
  test.slow();   // four full page loads, fonts and hero images included
  for (const path of ['/index.html', '/menu.html', '/order.html', '/contact.html']) {
    await gotoStubbed(page, path);
    const text = await page.locator('body').innerText();
    expect(text.toLowerCase(), `${path} still says "Continue to order"`).not.toContain('continue to order');
  }
});

test('a logged-out customer who taps Place order gets the login popup', async ({ page }) => {
  await addToCart(page, RIBYEYE);
  await openCart(page);

  for (const [id, value] of Object.entries(DETAILS)) {
    await page.locator(`#${id}`).fill(value);
  }

  await page.locator('#cartPlaceBtn').click();

  // AUTO_ACCOUNT = false in site.js: nothing is created behind their back,
  // the popup asks them to do it themselves.
  await expect(page.locator('#acctBox')).toBeVisible();
  await expect(page.locator('#acctReason')).toHaveText(
    'Please log in to place your order. Your cart and details are saved.'
  );
  await expect(page.locator('#acctTabCreate')).toHaveText('Create account');
  await expect(page.locator('#acctTabLogin')).toHaveText('Log in');

  // No error message: this is a choice, not a failure.
  await expect(page.locator('#cartError')).toBeHidden();

  // Closing the popup puts them back exactly where they were.
  await page.locator('#acctClose').click();
  await expect(page.locator('#acctBox')).toBeHidden();
  await expect(page.locator('#cartPanel')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);
  await expect(page.locator('#cartName')).toHaveValue(DETAILS.cartName);
  await expect(page.locator('#cartAddress')).toHaveValue(DETAILS.cartAddress);
  await expect(page.locator('#cartPlaceBtn')).toBeVisible();
  expect(await page.evaluate(() => window.eqCart.count())).toBe(1);

  // An email is no longer demanded before the popup either.
  await page.locator('#cartEmail').fill('');
  await page.locator('#cartPlaceBtn').click();
  await expect(page.locator('#acctBox')).toBeVisible();
  await expect(page.locator('#cartError')).toBeHidden();
});

test('the cart survives a page change', async ({ page }) => {
  test.slow(); // two full document loads; it ran out of time when the suite was busy

  await addToCart(page, RIBYEYE);
  await expect(page.locator('#navCartBadge')).toHaveText('1');

  await gotoStubbed(page, '/order.html');
  await expect(page.locator('#navCartBadge')).toHaveText('1');
  await openCart(page);
  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);
});
