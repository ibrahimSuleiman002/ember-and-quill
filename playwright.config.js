const { defineConfig } = require('@playwright/test');

const PORT = 5555;
const BASE_URL = `http://localhost:${PORT}`;

// Chromium only. The phone project is what customers actually hold in their
// hand; the desktop project is the wider layout.
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      }
    }
  ],
  webServer: {
    command: `npx serve -l ${PORT} .`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120000
  }
});
