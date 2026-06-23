import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:5500',
    headless: true,
  },
  webServer: {
    command: 'npx serve dist -l 5500',
    port: 5500,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
