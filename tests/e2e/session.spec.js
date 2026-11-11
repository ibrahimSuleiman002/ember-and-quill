// A customer who has logged in once should not have to do it again.
//
// Supabase Auth keeps the session in localStorage under `eq-customer-auth`
// (see supabase-config.js), so these specs log in through the real login box
// against a stubbed auth endpoint, then reload and change page. Nothing here
// reaches the live project: the fake token never expires during the test, so
// after the first login every page restores the session from storage without
// another request.

const { test, expect } = require('@playwright/test');
const {
  MENU_ROWS,
  RIBYEYE,
  stubSupabase,
  stubUser,
  stubSession,
  addToCart,
  openCart,
  loginViaBox,
  logOut,
  expectSignedIn,
  expectSignedOut
} = require('./helpers/fixtures');

const EMAIL = 'ada@example.com';
const NAME = 'Ada Obi';
const PHONE = '08031234567';
const ADDRESS = '12 Ember Lane, Wuse II, Abuja';
const PASSWORD = 'e2e-only-password';

// Mirrors the AUTO_ACCOUNT setting at the top of site.js — keep the two in
// step. While it is false, checkout never opens an account, so the test
// further down that covers that behaviour is skipped.
const AUTO_ACCOUNT = false;

function stubCustomer(overrides = {}) {
  const values = { email: EMAIL, fullName: NAME, phone: PHONE, address: ADDRESS, ...overrides };
  const user = stubUser(values);
  return {
    user,
    session: stubSession(user),
    profile: { full_name: values.fullName, phone: values.phone, address: values.address }
  };
}

// Each test logs in, reloads and changes page — three document loads plus the
// CDN scripts, so they need more than the default 30s when the suite is busy.
test.beforeEach(() => {
  test.slow();
});

test('logging in once keeps the customer signed in across a reload and a page change', async ({ page }) => {
  const customer = stubCustomer();
  await stubSupabase(page, MENU_ROWS, customer);

  await page.goto('/menu.html');
  // Signed out: the header has no account items and never offers "Log in".
  await expectSignedOut(page);

  await addToCart(page, RIBYEYE);
  await loginViaBox(page, EMAIL, PASSWORD);
  await expectSignedIn(page, NAME);

  await page.reload();
  await expectSignedIn(page, NAME);

  await page.goto('/order.html');
  await expectSignedIn(page, NAME);

  // The cart is still theirs and already knows their details.
  await openCart(page);
  await expect(page.locator('#cartName')).toHaveValue(NAME);
  await expect(page.locator('#cartPhone')).toHaveValue(PHONE);
  await expect(page.locator('#cartEmail')).toHaveValue(EMAIL);
  await expect(page.locator('#cartAddress')).toHaveValue(ADDRESS);
  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);

  // …with no login message anywhere in the panel.
  await expect(page.locator('#cartError')).toBeHidden();
  await expect(page.locator('#cartErrorLogin')).toBeHidden();
  await expect(page.locator('#acctBox')).toBeHidden();
});

test('only a manual Log out clears the session', async ({ page }) => {
  const customer = stubCustomer();
  await stubSupabase(page, MENU_ROWS, customer);

  await page.goto('/menu.html');
  await addToCart(page, RIBYEYE);
  await loginViaBox(page, EMAIL, PASSWORD);

  // Browsing around, including a full reload, changes nothing.
  await page.goto('/order.html');
  await expectSignedIn(page, NAME);
  await page.reload();
  await expectSignedIn(page, NAME);

  await logOut(page);
  await expectSignedOut(page);

  // Storage really was cleared, so a later visit starts signed out.
  await page.reload();
  await expectSignedOut(page);

  // Logging out must not cost them their basket.
  await openCart(page);
  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);
});

test('the login popup hands the customer back to their cart, and they order afterwards', async ({ page }) => {
  const customer = stubCustomer();
  customer.orderInsert = true;
  await stubSupabase(page, MENU_ROWS, customer);

  await page.goto('/menu.html');
  await addToCart(page, RIBYEYE);
  await openCart(page);
  await page.locator('#cartName').fill(NAME);
  await page.locator('#cartPhone').fill(PHONE);
  await page.locator('#cartAddress').fill(ADDRESS);

  await page.locator('#cartPlaceBtn').click();
  await expect(page.locator('#acctBox')).toBeVisible();

  // They log in from the popup itself.
  await page.locator('#acctTabLogin').click();
  await page.locator('#acctLoginEmail').fill(EMAIL);
  await page.locator('#acctLoginPassword').fill(PASSWORD);
  await page.locator('#acctLoginBtn').click();

  // Back to the cart: the dish, the typed details and the email from their
  // account — nothing had to be typed twice.
  await expect(page.locator('#acctBox')).toBeHidden();
  await expect(page.locator('#cartPanel')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#cartLines .cart-line-name')).toHaveText([RIBYEYE]);
  await expect(page.locator('#cartName')).toHaveValue(NAME);
  await expect(page.locator('#cartAddress')).toHaveValue(ADDRESS);
  await expect(page.locator('#cartEmail')).toHaveValue(EMAIL);

  // Now "Place order" works, and they stay on the page — the My orders
  // redirect only belongs to the switched-off auto-account flow.
  await page.locator('#cartPlaceBtn').click();
  await expect(page.locator('#cartSuccess')).toBeVisible();
  await expect(page.locator('#acctBox')).toBeHidden();
  await expect(page).toHaveURL(/\/menu/);
  expect(await page.evaluate(() => window.eqCart.count())).toBe(0);
});

test('a logged-in customer places the order directly, with no popup at all', async ({ page }) => {
  const customer = stubCustomer();
  customer.orderInsert = true;
  await stubSupabase(page, MENU_ROWS, customer);

  await page.goto('/menu.html');
  await addToCart(page, RIBYEYE);
  await loginViaBox(page, EMAIL, PASSWORD);
  await openCart(page);

  await expect(page.locator('#cartName')).toHaveValue(NAME);
  await expect(page.locator('#cartAddress')).toHaveValue(ADDRESS);

  await page.locator('#cartPlaceBtn').click();

  await expect(page.locator('#acctBox')).toBeHidden();
  await expect(page.locator('#cartError')).toBeHidden();
  await expect(page.locator('#cartSuccess')).toBeVisible();
  expect(await page.evaluate(() => window.eqCart.count())).toBe(0);
});

test('a first order creates the account, saves the details and keeps it signed in', async ({ page }) => {
  // Automatic account creation is switched off: AUTO_ACCOUNT = false at the
  // top of site.js. Flip that constant and the mirror above to bring this
  // behaviour — and this test — back.
  test.skip(!AUTO_ACCOUNT, 'AUTO_ACCOUNT = false in site.js: checkout no longer opens accounts');

  const NEW_EMAIL = 'bola@example.com';
  const NEW_NAME = 'Bola Arike';
  const NEW_PHONE = '08098765432';
  const NEW_ADDRESS = '7 Maitama Close, Abuja';

  const customer = stubCustomer({ email: NEW_EMAIL, fullName: NEW_NAME, phone: NEW_PHONE, address: NEW_ADDRESS });
  customer.orderInsert = true;
  const captured = await stubSupabase(page, MENU_ROWS, customer);

  await page.goto('/menu.html');
  await addToCart(page, RIBYEYE);
  await openCart(page);
  await page.locator('#cartName').fill(NEW_NAME);
  await page.locator('#cartPhone').fill(NEW_PHONE);
  await page.locator('#cartEmail').fill(NEW_EMAIL);
  await page.locator('#cartAddress').fill(NEW_ADDRESS);
  await page.locator('#cartPlaceBtn').click();

  // The auto-created session survives the redirect to My orders.
  // (`serve` rewrites /my-orders.html to /my-orders, so match both.)
  await expect(page).toHaveURL(/\/my-orders(\.html)?/);
  await expectSignedIn(page, NEW_NAME);

  // The account is opened with everything the customer typed, so the profile
  // row (and the next order) has the address, not just name and phone.
  await expect.poll(async () => captured.signUp).not.toBeNull();
  expect(captured.signUp.email).toBe(NEW_EMAIL);
  expect(captured.signUp.data).toMatchObject({
    full_name: NEW_NAME,
    phone: NEW_PHONE,
    address: NEW_ADDRESS
  });

  // Next time, the checkout form arrives already filled in.
  await page.goto('/menu.html');
  await addToCart(page, RIBYEYE);
  await openCart(page);
  await expect(page.locator('#cartName')).toHaveValue(NEW_NAME);
  await expect(page.locator('#cartPhone')).toHaveValue(NEW_PHONE);
  await expect(page.locator('#cartEmail')).toHaveValue(NEW_EMAIL);
  await expect(page.locator('#cartAddress')).toHaveValue(NEW_ADDRESS);

  // Still no login step in the way.
  await expect(page.locator('#acctBox')).toBeHidden();
  await expect(page.locator('#cartErrorLogin')).toBeHidden();
});
