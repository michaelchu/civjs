import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/browser',
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /creation-flow\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev --prefix apps/client -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
