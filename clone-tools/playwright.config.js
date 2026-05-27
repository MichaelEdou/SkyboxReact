// Playwright test config for Skybox Global static clone.
// Runs against an already-running server at BASE_URL (default 8088).

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,        // single in-process server, avoid request floods
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { outputFolder: 'test-report', open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
