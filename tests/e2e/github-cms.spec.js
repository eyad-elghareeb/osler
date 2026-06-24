import { test, expect } from '@playwright/test';

test.describe('GitHub CMS', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api.github.com/**', async route => {
      const url = route.request().url();
      if (url.includes('/repos/') && url.includes('/pulls')) {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ number: 42, title: 'Test PR', html_url: 'https://github.com/test/test/pull/42' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ login: 'test-user', name: 'Test User' }) });
      }
    });
  });

  test('hub page shows sync button', async ({ page }) => {
    await page.goto('/hub/index.html');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText('Sync', { timeout: 10000 });
  });

  test('content preview works via player', async ({ page }) => {
    await page.goto('/player.html?path=content/sample-quiz.json');
    await expect(page.locator('body')).toContainText('Sample Cardiology Quiz', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Start Quiz');
  });
});
