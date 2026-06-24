import { test, expect } from '@playwright/test';

test.describe('OSCE simulation', () => {
  test('displays scenario content', async ({ page }) => {
    await page.goto('/player.html?uid=sample-osce-001');
    await expect(page.locator('body')).toContainText('OSCE Virtual Patient', { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });

  test('loads simulation without errors', async ({ page }) => {
    await page.goto('/player.html?uid=sample-osce-001');
    await expect(page.locator('body')).toContainText('OSCE Virtual Patient', { timeout: 10000 });

    const inputs = page.locator('input[type="checkbox"], input[type="radio"]');
    if (await inputs.count() > 0) {
      await inputs.first().click({ force: true });
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
