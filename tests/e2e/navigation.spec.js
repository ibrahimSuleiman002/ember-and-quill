// The three-line menu: opens, and closes when the customer taps outside.
// The hamburger only exists below 1024px, so these run in the phone project.

const { test, expect } = require('@playwright/test');
const { gotoStubbed } = require('./helpers/fixtures');

const NAV = '#navLinks';

test('the three-line menu opens and closes', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'the hamburger only exists at phone widths');

  await gotoStubbed(page, '/menu.html');

  const hamburger = page.locator('#hamburger');
  const links = page.locator(NAV);

  await expect(hamburger).toBeVisible();
  await expect(links).not.toHaveClass(/active/);

  await hamburger.click();
  await expect(links).toHaveClass(/active/);
  await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#siteBackdrop')).toHaveClass(/open/);
  await expect(links.locator('a').first()).toBeVisible();

  // Tap outside the drawer — bottom-left corner, away from the panel.
  await page.locator('#siteBackdrop').click({ position: { x: 10, y: 700 } });

  await expect(links).not.toHaveClass(/active/);
  await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#siteBackdrop')).not.toHaveClass(/open/);
});

test('tapping the three lines again closes the menu', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'the hamburger only exists at phone widths');

  await gotoStubbed(page, '/menu.html');
  const hamburger = page.locator('#hamburger');

  await hamburger.click();
  await expect(page.locator(NAV)).toHaveClass(/active/);

  await hamburger.click();
  await expect(page.locator(NAV)).not.toHaveClass(/active/);
});

test('Escape closes the menu too', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'the hamburger only exists at phone widths');

  await gotoStubbed(page, '/menu.html');
  await page.locator('#hamburger').click();
  await expect(page.locator(NAV)).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await expect(page.locator(NAV)).not.toHaveClass(/active/);
});

test('at desktop width the nav links are always shown and there is no hamburger', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'desktop width only');

  await gotoStubbed(page, '/menu.html');
  await expect(page.locator('#hamburger')).toBeHidden();
  await expect(page.locator(NAV).locator('a').first()).toBeVisible();
});
