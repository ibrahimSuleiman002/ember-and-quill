// Shared helpers for the safe (read-only) end-to-end specs.
//
// The menu is served by public.menu_public in Supabase. Safe specs replace
// that one request with a fixed fixture so they are deterministic and so
// they can never write to — or depend on — the live project.

const { expect } = require('@playwright/test');

const RIBYEYE = 'Ember-Grilled Ribeye';
const SUYA = 'Full Chicken Suya';
const JOLLOF = 'Jollof Rice & Grilled Chicken';
const PRAWNS = 'Grilled King Prawns';       // the unavailable dish
const CHEESECAKE = 'Chin Chin Cheesecake';

const MENU_ROWS = [
  {
    id: 1,
    slug: 'ember-grilled-ribeye',
    name: RIBYEYE,
    category: 'From the Fire',
    description: '250g ribeye over embers, smoked pepper butter.',
    price: 18500,
    image_url: 'images/ribeye.jpg',
    available: true,
    sort_order: 1
  },
  {
    id: 2,
    slug: 'full-chicken-suya',
    name: SUYA,
    category: 'From the Fire',
    description: 'Full chicken rubbed with yaji and grilled over coal.',
    price: 14000,
    image_url: 'images/chicken-suya.jpg',
    available: true,
    sort_order: 2
  },
  {
    id: 3,
    slug: 'jollof-rice-grilled-chicken',
    name: JOLLOF,
    category: 'Mains',
    description: 'Smoky jollof rice with grilled chicken.',
    price: 8500,
    image_url: 'images/jollof-rice.jpg',
    available: true,
    sort_order: 3
  },
  {
    id: 4,
    slug: 'grilled-king-prawns',
    name: PRAWNS,
    category: 'Starters',
    description: 'Prawns grilled in their shells with garlic butter.',
    price: 11000,
    image_url: 'images/grilled-prawns.jpg',
    available: false,
    sort_order: 4
  },
  {
    id: 5,
    slug: 'chin-chin-cheesecake',
    name: CHEESECAKE,
    category: 'Desserts',
    description: 'Baked cheesecake on a chin chin base.',
    price: 5500,
    image_url: 'images/chin-chin-cheesecake.jpg',
    available: true,
    sort_order: 5
  }
];

// Everything the specs need from the backend, answered locally: the menu
// fixture for reads, an abort for anything that would be a write.
//
// `auth` opts in to a fake Supabase Auth/API for one spec at a time, so a
// login or an auto-created account can be exercised without touching the
// live project. Left out, every write is still aborted.
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// An unsigned token: supabase-js only reads the claims, it cannot verify a
// signature without the project's JWT secret.
function fakeJwt(claims) {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
}

function stubUser(options) {
  const now = new Date().toISOString();
  return {
    id: options.id || 'e2e-customer-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: options.email,
    phone: '',
    confirmed_at: now,
    email_confirmed_at: now,
    last_sign_in_at: now,
    created_at: now,
    updated_at: now,
    user_metadata: {
      full_name: options.fullName || '',
      phone: options.phone || '',
      address: options.address || ''
    },
    app_metadata: { provider: 'email', providers: ['email'] },
    identities: []
  };
}

function stubSession(user) {
  const expiresIn = 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: fakeJwt({
      sub: user.id,
      email: user.email,
      aud: 'authenticated',
      role: 'authenticated',
      exp: expiresAt
    }),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: 'e2e-refresh-token',
    user: user
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status: status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function stubSupabase(page, rows = MENU_ROWS, auth = {}) {
  const captured = { signUp: null, orderInsert: null };

  await page.route((url) => url.hostname.endsWith('supabase.co'), (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (path.endsWith('/rest/v1/menu_public')) {
      return json(route, rows);
    }

    if (method === 'GET' && path.endsWith('/rest/v1/profiles') && auth.profile) {
      // maybeSingle() asks for one object, not an array.
      return json(route, auth.profile);
    }

    if (method === 'POST' && path.endsWith('/auth/v1/token') && auth.session) {
      return json(route, auth.session);
    }

    if (method === 'POST' && path.endsWith('/auth/v1/signup') && auth.session) {
      try {
        captured.signUp = JSON.parse(request.postData() || 'null');
      } catch (err) {
        captured.signUp = null;
      }
      // GoTrue answers a sign-up that can log straight in with a token
      // response — the session fields at the top level, not under "session".
      return json(route, auth.session);
    }

    if (method === 'POST' && path.endsWith('/auth/v1/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    // The set-password link an auto-created account gets sent; only the
    // "we will email you" acknowledgement is needed to keep the console clean.
    if (method === 'POST' && path.endsWith('/auth/v1/recover') && auth.session) {
      return json(route, {});
    }

    if (method === 'POST' && path.endsWith('/rest/v1/orders') && auth.orderInsert) {
      try {
        captured.orderInsert = JSON.parse(request.postData() || 'null');
      } catch (err) {
        captured.orderInsert = null;
      }
      return json(route, [], 201);
    }

    if (method !== 'GET') return route.abort();

    return json(route, path.startsWith('/rest/v1/') ? [] : {});
  });

  return captured;
}

async function gotoStubbed(page, path) {
  await stubSupabase(page);
  await page.goto(path);
}

function card(page, slug) {
  return page.locator(`.menu-card[data-menu-slug="${slug}"]`);
}

function categorySection(page, name) {
  return page.locator('.menu-category').filter({
    has: page.locator(`[data-cat-toggle="${name}"]`)
  });
}

// The panel slides in from the right over ~0.3s. Measurements taken mid
// flight are wrong, so wait until it is flush against the edge.
async function panelIsSettled(page) {
  const width = page.viewportSize().width;
  await expect
    .poll(async () => {
      const box = await page.locator('#cartPanel').boundingBox();
      return box ? Math.abs(Math.round(box.x + box.width) - width) : 999;
    }, { timeout: 3000 })
    .toBeLessThanOrEqual(1);
}

async function openCart(page) {
  await page.locator('#navCart').click();
  await expect(page.locator('#cartPanel')).toHaveClass(/\bopen\b/);
  await panelIsSettled(page);
}

async function addToCart(page, name) {
  await page.locator(`.menu-add-btn[data-add-name="${name}"]`).click();
}

// A phone-width page opens with only the first category expanded.
async function openAllCategories(page) {
  const toggles = page.locator('[data-cat-toggle]');
  const n = await toggles.count();
  for (let i = 0; i < n; i++) {
    if ((await toggles.nth(i).getAttribute('aria-expanded')) !== 'true') {
      await toggles.nth(i).click();
    }
  }
}

// "Without scrolling" really means: the whole element is inside the visible
// part of the panel body, and the panel body is not scrolled at all.
async function expectNoScrollInsidePanel(page, locator) {
  await panelIsSettled(page);

  const body = await page.locator('#cartPanelBody').boundingBox();
  const box = await locator.boundingBox();
  expect(box, 'element has no bounding box').not.toBeNull();
  expect(body).not.toBeNull();

  const scrollTop = await page.locator('#cartPanelBody').evaluate((el) => el.scrollTop);
  expect(scrollTop, 'panel body must not be scrolled').toBe(0);

  expect(box.x).toBeGreaterThanOrEqual(body.x - 1);
  expect(box.y).toBeGreaterThanOrEqual(body.y - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(body.x + body.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height + 1);
}

// The "Place order" bar sits outside the scrollable body, pinned to the
// bottom of the panel — it only has to be on screen.
async function expectInsideViewport(page, locator) {
  await panelIsSettled(page);

  const size = page.viewportSize();
  const box = await locator.boundingBox();
  expect(box, 'element has no bounding box').not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
}

// The login box is the site's only way in, so the specs open it the way a
// customer reaches it and submit the real form.
async function loginViaBox(page, email, password) {
  await page.evaluate(() => window.authUI.openLogin({ tab: 'login' }));
  await expect(page.locator('#acctLoginForm')).toBeVisible();
  await page.locator('#acctLoginEmail').fill(email);
  await page.locator('#acctLoginPassword').fill(password);
  await page.locator('#acctLoginBtn').click();
  await expect(page.locator('#acctBox')).toBeHidden();
}

async function expectSignedIn(page, fullName) {
  // The header greets with the first name only (displayName in auth.js).
  const firstName = String(fullName).trim().split(/\s+/)[0];
  await expect(page.locator('#navGreetingItem')).toContainText(`Hi, ${firstName}`);
  await expect(page.locator('#navMyOrdersItem')).toBeVisible();
  await expect(page.locator('#navLogout')).toBeVisible();
  // Nothing in the header ever asks a signed-in customer to log in.
  await expect(page.locator('#navLinks')).not.toContainText(/log in/i);
}

async function expectSignedOut(page) {
  await expect(page.locator('#navGreetingItem')).toHaveCount(0);
  await expect(page.locator('#navMyOrdersItem')).toHaveCount(0);
  await expect(page.locator('#navLogout')).toHaveCount(0);
}

// Phones keep the account items behind the hamburger; desktop shows them inline.
async function logOut(page) {
  const hamburger = page.locator('#hamburger');
  if (await hamburger.isVisible()) await hamburger.click();
  await page.locator('#navLogout').click();
  await expect(page.locator('#navLogout')).toHaveCount(0);
}

module.exports = {
  MENU_ROWS,
  RIBYEYE,
  SUYA,
  JOLLOF,
  PRAWNS,
  CHEESECAKE,
  stubSupabase,
  stubUser,
  stubSession,
  gotoStubbed,
  card,
  categorySection,
  openCart,
  addToCart,
  openAllCategories,
  expectNoScrollInsidePanel,
  expectInsideViewport,
  loginViaBox,
  logOut,
  expectSignedIn,
  expectSignedOut
};
