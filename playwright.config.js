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
    command: 'npx http-server dist -p 5500 -c-1 --cors',
    port: 5500,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
