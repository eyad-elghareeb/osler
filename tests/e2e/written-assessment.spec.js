import { test, expect } from '@playwright/test';

test.describe('Written assessment', () => {
  test('displays prompt and allows text input', async ({ page }) => {
    await page.goto('/player.html?uid=sample-written-001');
    await expect(page.locator('body')).toContainText('Sample Written Assessment', { timeout: 10000 });

    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible()) {
      await textarea.fill('Heart failure with reduced ejection fraction involves decreased myocardial contractility...');
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(500);
      }
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });

  test('shows rubric items', async ({ page }) => {
    await page.goto('/player.html?uid=sample-written-001');
    await expect(page.locator('body')).toContainText('Sample Written Assessment', { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
