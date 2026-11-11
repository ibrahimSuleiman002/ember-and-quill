// The menu list itself: categories, accordion, availability.
// Read-only — Supabase is stubbed by tests/e2e/helpers/fixtures.js.

const { test, expect } = require('@playwright/test');
const {
  MENU_ROWS,
  RIBYEYE,
  gotoStubbed,
  card,
  categorySection
} = require('./helpers/fixtures');

const FIRST_CATEGORY = 'From the Fire';   // open on phone and desktop

test.beforeEach(async ({ page }) => {
  // A fresh browser context per test: the localStorage cart starts empty.
  await gotoStubbed(page, '/menu.html');
  await expect(page.locator('#menuContent .menu-category').first()).toBeVisible();
});

test('menu loads and groups dishes under their category headings', async ({ page }) => {
  const headings = page.locator('#menuContent .menu-cat-name');
  await expect(headings).toHaveCount(4);
  await expect(headings).toHaveText(['From the Fire', 'Mains', 'Starters', 'Desserts']);

  await expect(page.locator('#menuContent .menu-card')).toHaveCount(MENU_ROWS.length);

  for (const row of MENU_ROWS) {
    const section = categorySection(page, row.category);
    await expect(section.locator(`.menu-card[data-menu-slug="${row.slug}"]`)).toHaveCount(1);
    await expect(section.locator('.menu-cat-count')).toHaveText(
      `${sectionCardCount(row.category)} ${sectionCardCount(row.category) === 1 ? 'dish' : 'dishes'}`
    );
  }

  const ribeye = card(page, 'ember-grilled-ribeye');
  await expect(ribeye.locator('.menu-card-name')).toHaveText(RIBYEYE);
  await expect(ribeye.locator('.menu-card-price')).toHaveText('₦18,500');
  await expect(ribeye.locator('.menu-card-img')).toHaveAttribute('src', /images\/ribeye\.jpg$/);
});

function sectionCardCount(category) {
  return MENU_ROWS.filter((row) => row.category === category).length;
}

test('tapping a category heading collapses it, tapping again expands it', async ({ page }) => {
  const section = categorySection(page, FIRST_CATEGORY);
  const toggle = section.locator('.menu-cat-toggle');
  const dishes = section.locator('.menu-card');

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(dishes.first()).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(section).toHaveClass(/cat-closed/);
  await expect(dishes.first()).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(section).not.toHaveClass(/cat-closed/);
  await expect(dishes.first()).toBeVisible();
});

test('collapsing one category leaves the others as they were', async ({ page }) => {
  const mains = categorySection(page, 'Mains');
  const fire = categorySection(page, FIRST_CATEGORY);

  const mainsWasOpen = (await mains.locator('.menu-cat-toggle').getAttribute('aria-expanded')) === 'true';

  await fire.locator('.menu-cat-toggle').click();
  await expect(fire).toHaveClass(/cat-closed/);
  await expect(mains.locator('.menu-cat-toggle')).toHaveAttribute(
    'aria-expanded', String(mainsWasOpen)
  );
});

test('an unavailable dish is marked and cannot be added to the cart', async ({ page }) => {
  // Starters is closed by default on a phone — open it first.
  const starters = categorySection(page, 'Starters');
  const toggle = starters.locator('.menu-cat-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();

  const prawns = card(page, 'grilled-king-prawns');
  await expect(prawns).toHaveClass(/menu-card--unavailable/);
  await expect(prawns.locator('.menu-unavailable-badge')).toHaveText('Unavailable');
  await expect(prawns.locator('.menu-add-btn')).toHaveCount(0);
  await expect(prawns.locator('.qty-stepper')).toHaveCount(0);

  // Tapping anywhere on the card must not create a cart line.
  await prawns.locator('.menu-card-name').click();
  await expect(prawns.locator('.menu-card-body')).toBeVisible();

  expect(await page.evaluate(() => window.eqCart.count())).toBe(0);
  await expect(page.locator('#navCartBadge')).toBeHidden();

  // And the available dishes in the same list still offer an Add button.
  await expect(card(page, 'ember-grilled-ribeye').locator('.menu-add-btn')).toBeVisible();
  await expect(card(page, 'grilled-king-prawns').locator('.menu-add-btn')).toHaveCount(0);
});
