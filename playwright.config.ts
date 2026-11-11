import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // A machine with its own Chromium (no `playwright install`) can point at it.
    ...(process.env.E2E_CHROMIUM
      ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } }
      : {}),
  },
  projects: [
    { name: 'pixel-8', use: { ...devices['Pixel 8'] } },
    // WebKit is not installed in CI; run locally with E2E_WEBKIT=1 (`pnpm exec playwright install webkit`).
    ...(process.env.E2E_WEBKIT ? [{ name: 'iphone-15', use: { ...devices['iPhone 15'] } }] : []),
  ],
  // The built server with the in-memory repository: no credentials, nothing persisted.
  webServer: {
    command: 'node apps/server/dist/main.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      REPO_DRIVER: 'memory',
      RATE_LIMIT_OFF: '1',
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
