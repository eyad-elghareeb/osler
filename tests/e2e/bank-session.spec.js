import { test, expect } from '@playwright/test';

test.describe('Bank question session', () => {
  test('displays passage and allows interaction', async ({ page }) => {
    await page.goto('/player.html?uid=sample-bank-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Question Bank', { timeout: 10000 });

    const radio = page.locator('input[type="radio"]').first();
    if (await radio.isVisible()) {
      await radio.click({ force: true });
      const submitBtn = page.locator('button:has-text("Submit")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(500);
      }
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });

  test('loads without errors', async ({ page }) => {
    await page.goto('/player.html?uid=sample-bank-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Question Bank', { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
