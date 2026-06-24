import { test, expect } from '@playwright/test';

test.describe('Firebase auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/identitytoolkit.googleapis.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          idToken: 'mock-id-token',
          refreshToken: 'mock-refresh-token',
          localId: 'mock-user-123',
          displayName: 'Test User',
          email: 'test@example.com',
        }),
      });
    });
  });

  test('hub loads with auth UI elements', async ({ page }) => {
    await page.goto('/hub/index.html');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText('Osler', { timeout: 10000 });
  });

  test('sync button is present in hub topbar', async ({ page }) => {
    await page.goto('/hub/index.html');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText('Sync', { timeout: 10000 });
  });
});
