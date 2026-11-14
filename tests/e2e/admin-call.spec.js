// The "Call customer" controls on the admin dashboard.
//
// Everything is stubbed here, including the admin sign-in, so the spec never
// reaches the live project and never writes a row. The one POST the dashboard
// is allowed to make is the activity-log entry, and that is captured rather
// than sent; the realtime socket is pointed at a dead port so even the
// read-only subscription handshake cannot leave the machine.

const { test, expect } = require('@playwright/test');
const { stubUser, stubSession } = require('./helpers/fixtures');

const ADMIN_EMAIL = 'e2e-admin@example.com';

const WEBSITE_ORDERS = [
  {
    id: '11111111-1111-1111-1111-111111111142',
    order_no: 42,
    customer_name: 'Amina Bello',
    // Typed the way a customer types it: spaces in the middle.
    phone: '0803 123 4567',
    email: 'amina@example.com',
    address: '12 Ada Close, Ikeja',
    items: [{ name: 'Jollof Rice', qty: 2, price: 8500 }],
    total: 17000,
    status: 'PENDING_APPROVAL',
    paid_at: null,
    created_at: '2026-11-14T09:00:00.000Z',
    user_id: 'customer-amina'
  },
  {
    id: '11111111-1111-1111-1111-111111111143',
    order_no: 43,
    customer_name: 'Chidi Okeke',
    // No number at all: the row must say so instead of offering a dead link.
    phone: '',
    email: 'chidi@example.com',
    address: '4 Boyd Road, Yaba',
    items: [{ name: 'Chin Chin Cheesecake', qty: 1, price: 5500 }],
    total: 5500,
    status: 'DELIVERED',
    paid_at: '2026-11-13T10:00:00.000Z',
    created_at: '2026-11-13T10:00:00.000Z',
    user_id: 'customer-chidi'
  },
  {
    id: '11111111-1111-1111-1111-111111111144',
    order_no: 44,
    customer_name: 'Fatima Yusuf',
    // Already in international form.
    phone: '234-803-999-0001',
    email: 'fatima@example.com',
    address: '9 Allen Avenue, Ikeja',
    items: [{ name: 'Grilled King Prawns', qty: 1, price: 11000 }],
    total: 11000,
    status: 'PAID',
    paid_at: '2026-11-12T10:00:00.000Z',
    created_at: '2026-11-12T10:00:00.000Z',
    user_id: 'customer-fatima'
  }
];

const IRIS_ORDERS = [
  {
    id: 900,
    order_number: 'IR-7',
    customer_name: 'Bola Ade',
    // The Iris RPC names the column customer_phone and brackets the number.
    customer_phone: '(0803) 123-4567',
    customer_email: 'bola@example.com',
    address: '3 Adeyemi Road, Surulere',
    items: [{ name: 'Full Chicken Suya', quantity: 1, unit_price_minor: 1400000 }],
    total_minor: 1400000,
    currency: 'NGN',
    status: 'PENDING_APPROVAL',
    payment_status: 'paid',
    fulfillment: 'delivery',
    created_at: '2026-11-11T10:00:00.000Z'
  }
];

// The activity log the spec asserts against, plus the fake session, filled in
// by the beforeEach below. Module scope because the specs run one file at a
// time per worker and each worker gets its own copy of this module.
let captured = null;

async function stubAdmin(page) {
  // The dashboard sheet pulls its fonts off Google; a slow font request
  // delays the load event and makes the test wait for nothing. Answer it
  // locally with no font-face at all.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  // Playwright cannot route a WebSocket, so the realtime endpoint is pointed
  // somewhere that refuses to answer instead.
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    function StubWebSocket(url, protocols) {
      const text = String(url);
      if (text.indexOf('supabase.co') !== -1) return new Native('ws://127.0.0.1:9', protocols);
      return new Native(url, protocols);
    }
    StubWebSocket.prototype = Native.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((name) => {
      StubWebSocket[name] = Native[name];
    });
    window.WebSocket = StubWebSocket;
  });

  await page.route((url) => url.hostname.endsWith('supabase.co'), (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    const send = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });

    if (method === 'POST' && path.endsWith('/auth/v1/token')) {
      return send(captured.session);
    }

    if (method === 'POST' && path.endsWith('/auth/v1/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    if (method === 'POST' && path.startsWith('/rest/v1/rpc/')) {
      // supabase-js posts to /rest/v1/rpc/<function name>.
      const name = path.split('/').pop();
      if (name === 'is_admin') return send(true);
      if (name === 'admin_iris_orders') return send(IRIS_ORDERS);
      if (name === 'admin_iris_stats') {
        return send({ chats_total: 1, chats_open: 0, orders_total: 1, orders_value_minor: 1400000 });
      }
      return send(null);
    }

    if (method === 'POST' && path.endsWith('/rest/v1/activity_log')) {
      captured.activity.push(JSON.parse(request.postData() || 'null'));
      return send([], 201);
    }

    // Nothing else may reach the network.
    if (method !== 'GET') return route.abort();

    if (path.endsWith('/rest/v1/orders')) return send(WEBSITE_ORDERS);
    return send(path.startsWith('/rest/v1/') ? [] : {});
  });
}

async function signInAsAdmin(page) {
  await expect(page.locator('#loginView')).toBeVisible();
  await page.locator('#loginEmail').fill(ADMIN_EMAIL);
  await page.locator('#loginPassword').fill('e2e-password');
  await page.locator('#loginBtn').click();

  try {
    await expect(page.locator('#adminMain')).toBeVisible();
  } catch (err) {
    // The dashboard keeps the login screen up and puts the reason on it, so
    // say what the page said instead of only that the main view never came.
    const said = await page.locator('#loginError').textContent();
    const hasClient = await page.evaluate(() => typeof window.eqSupabase);
    throw new Error(`admin sign-in did not reach the dashboard. The login screen said: ${JSON.stringify((said || '').trim())}; window.eqSupabase is ${hasClient}`);
  }
}

async function gotoHash(page, hash) {
  await page.evaluate((value) => { window.location.hash = value; }, hash);
  const view = hash.split('/')[0].replace('#', '');
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

function rowFor(page, orderNo) {
  return page.locator('#ordersList tbody tr').filter({ hasText: `ORD-${orderNo}` }).first();
}

test.describe('admin: call customer', () => {
  test.beforeEach(async ({ page, context }) => {
    captured = {
      session: stubSession(stubUser({ email: ADMIN_EMAIL, fullName: 'E2E Admin' })),
      activity: []
    };

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch (err) {
      /* Older Chromium builds do not know clipboard-read; the copy test then
         fails on its own terms rather than here. */
    }

    await stubAdmin(page);
    await page.goto('/admin.html');
    await signInAsAdmin(page);
  });

  test('a typed Nigerian number dials in international form', async ({ page }) => {
    await gotoHash(page, '#orders');

    const amina = rowFor(page, '0042');
    await expect(amina.locator('.admin-call-icon')).toHaveAttribute('href', 'tel:+2348031234567');
    await expect(amina.locator('.admin-phone-number')).toHaveText('0803 123 4567');

    // Already international: the plus stays and nothing is doubled up.
    const fatima = rowFor(page, '0044');
    await expect(fatima.locator('.admin-call-icon')).toHaveAttribute('href', 'tel:+2348039990001');
  });

  test('a missing number shows "No phone number" and no call link', async ({ page }) => {
    await gotoHash(page, '#orders');

    const row = rowFor(page, '0043');
    await expect(row.locator('.admin-no-phone')).toHaveText('No phone number');
    await expect(row.locator('.admin-call-icon')).toHaveCount(0);
    await expect(row.locator('[data-copy-number]')).toHaveCount(0);
  });

  test('copying puts the number on the clipboard and says "Copied"', async ({ page }) => {
    await gotoHash(page, '#orders');

    const copy = rowFor(page, '0042').locator('.admin-copy-icon');
    await copy.click();
    await expect(copy.locator('.admin-copy-text')).toHaveText('Copied');

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('+2348031234567');
  });

  test('calling an order is written to the activity log', async ({ page }) => {
    await gotoHash(page, '#orders');

    await rowFor(page, '0042').locator('.admin-call-icon').click();

    await expect.poll(() => captured.activity.length).toBe(1);
    const entry = captured.activity[0];
    expect(entry.action).toBe('CUSTOMER_CALLED');
    expect(entry.target_type).toBe('order');
    expect(entry.note).toBe('Amina Bello about order ORD-0042');
    expect(entry.actor_email).toBe(ADMIN_EMAIL);
  });

  test('the order page shows Call customer with the number, WhatsApp beside it', async ({ page }) => {
    await gotoHash(page, '#order/11111111-1111-1111-1111-111111111142');

    const site = page.locator('#orderDetailBody .admin-contact-row');
    await expect(site.locator('.admin-call-btn')).toHaveAttribute('href', 'tel:+2348031234567');
    await expect(site.locator('.admin-call-text')).toHaveText('Call customer');
    await expect(site.locator('.admin-phone-number')).toHaveText('0803 123 4567');
    await expect(site.locator('.admin-copy-btn')).toHaveCount(1);

    // An Iris order keeps the WhatsApp button it already had, next to Call.
    await page.evaluate(() => { window.location.hash = '#order/iris-900'; });
    const iris = page.locator('#orderDetailBody .admin-contact-row');
    await expect(iris.locator('.admin-call-btn')).toHaveAttribute('href', 'tel:+2348031234567');
    await expect(iris.locator('.admin-wa-btn')).toHaveAttribute('href', 'https://wa.me/2348031234567');
    await expect(iris.locator('.admin-phone-number')).toHaveText('(0803) 123-4567');
  });

  test('the customers list has the same control next to the number', async ({ page }) => {
    await gotoHash(page, '#customers');

    const rows = page.locator('#customersList tbody tr');
    const amina = rows.filter({ hasText: 'Amina Bello' }).first();
    await expect(amina.locator('.admin-call-icon')).toHaveAttribute('href', 'tel:+2348031234567');
    await expect(amina.locator('.admin-phone-number')).toHaveText('0803 123 4567');

    const chidi = rows.filter({ hasText: 'Chidi Okeke' }).first();
    await expect(chidi.locator('.admin-no-phone')).toHaveText('No phone number');
  });

  test('the contact controls fit the screen without sideways scroll', async ({ page }) => {
    await gotoHash(page, '#orders');

    const size = page.viewportSize();
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(0);

    const contact = rowFor(page, '0042').locator('.admin-contact--compact');
    await expect(contact).toBeVisible();

    const box = await contact.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x, 'the call button starts inside the screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'the call button ends inside the screen')
      .toBeLessThanOrEqual(size.width + 1);
  });
});
