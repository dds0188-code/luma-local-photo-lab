const { defineConfig, devices } = require('@playwright/test');

const base = {
  testDir: './tests',
  testMatch: 'browser-smoke.spec.cjs',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 120000,
  expect: { timeout: 7000 },
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
};

module.exports = defineConfig({
  ...base,
  projects: [
    { name: 'chromium-desktop-and-mobile-viewport', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop-and-mobile-viewport', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-safari-engine-desktop-and-mobile-viewport', use: { ...devices['Desktop Safari'] } }
  ]
});
