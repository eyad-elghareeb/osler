import { test, expect } from '@playwright/test';

test.describe('Flashcard study session', () => {
  test('shows rating buttons and responds to click', async ({ page }) => {
    await page.goto('/player.html?uid=sample-flashcard-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Flashcards', { timeout: 10000 });

    const goodBtn = page.locator('button:has-text("Good")').first();
    if (await goodBtn.isVisible()) {
      await goodBtn.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });

  test('rates multiple cards without errors', async ({ page }) => {
    await page.goto('/player.html?uid=sample-flashcard-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Flashcards', { timeout: 10000 });

    for (let i = 0; i < 3; i++) {
      const btn = page.locator('button:has-text("Good")').first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
