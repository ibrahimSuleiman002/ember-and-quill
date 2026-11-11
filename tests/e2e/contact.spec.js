// The contact page "Why are you contacting us?" picker. Read-only.

const { test, expect } = require('@playwright/test');
const { gotoStubbed } = require('./helpers/fixtures');

const CONTINUE = '#waContinue';

test.beforeEach(async ({ page }) => {
  await gotoStubbed(page, '/contact.html');
});

test('picking a reason builds a prefilled WhatsApp message', async ({ page }) => {
  await expect(page.locator('#waReasons .wa-reason')).toHaveCount(6);
  await expect(page.locator('#waFollowup')).toBeHidden();

  await page.locator('input[name="waReason"][value="order"]').check();
  await expect(page.locator('#waFollowup')).toBeVisible();

  // The free-text box is only for "Something else".
  await expect(page.locator('#waMessageField')).toBeHidden();

  await page.locator('#waName').fill('Adaeze');

  const link = page.locator(CONTINUE);
  await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
  await expect(link).toHaveAttribute('target', '_blank');

  const href = await link.getAttribute('href');
  const url = new URL(href);
  expect(url.pathname).toBe('/2347063134521');

  const message = url.searchParams.get('text');
  expect(message).toBe('Hello Ember & Quill, my name is Adaeze. I would like to place an order.');

  // The link itself is what opens WhatsApp — no form submit, no database.
  expect(await link.evaluate((el) => el.classList.contains('is-disabled'))).toBe(false);
});

test('each reason writes its own message, and the name is optional', async ({ page }) => {
  await page.locator('input[name="waReason"][value="reservation"]').check();
  let message = new URL(await page.locator(CONTINUE).getAttribute('href')).searchParams.get('text');
  expect(message).toContain('I would like to make a reservation.');
  expect(message).not.toContain('my name is');

  await page.locator('input[name="waReason"][value="catering"]').check();
  message = new URL(await page.locator(CONTINUE).getAttribute('href')).searchParams.get('text');
  expect(message).toContain('catering or an event');
});

test('"Something else" needs a message before it will continue', async ({ page }) => {
  await page.locator('input[name="waReason"][value="other"]').check();
  await expect(page.locator('#waMessageField')).toBeVisible();

  const link = page.locator(CONTINUE);
  await expect(link).toHaveClass(/is-disabled/);
  await expect(link).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#waNote')).toBeVisible();

  await page.locator('#waMessage').fill('Do you cater for a wedding on 12 December?');
  await expect(link).not.toHaveClass(/is-disabled/);
  await expect(page.locator('#waNote')).toBeHidden();

  const message = new URL(await link.getAttribute('href')).searchParams.get('text');
  expect(message).toContain('Do you cater for a wedding on 12 December?');
});
