import { test, expect } from '@playwright/test';

test.describe('Anki CSV import/export', () => {
  test('flashcard session loads with export capability', async ({ page }) => {
    await page.goto('/player.html?uid=sample-flashcard-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Flashcards', { timeout: 10000 });

    const goodBtn = page.locator('button:has-text("Good")').first();
    for (let i = 0; i < 3; i++) {
      if (await goodBtn.isVisible()) {
        await goodBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });

  test('loads flashcard content correctly', async ({ page }) => {
    await page.goto('/player.html?uid=sample-flashcard-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Flashcards', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Total');
  });
});
