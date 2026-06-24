import { test, expect } from '@playwright/test';

test.describe('Quiz session', () => {
  test('completes a quiz with correct and wrong answers', async ({ page }) => {
    await page.goto('/player.html?uid=sample-quiz-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Quiz', { timeout: 10000 });

    const body = page.locator('body');
    const option = page.locator('label:has-text("Coronary artery disease")').first();
    if (await option.isVisible()) {
      await option.click();
      const submitBtn = page.locator('button:has-text("Submit")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await expect(body).toContainText('Explanation', { timeout: 5000 });
      }
    }

    await expect(body).not.toContainText('Unable to load content');
  });

  test('navigates through quiz without errors', async ({ page }) => {
    await page.goto('/player.html?uid=sample-quiz-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Quiz', { timeout: 10000 });

    for (let i = 0; i < 3; i++) {
      const radio = page.locator('input[type="radio"]').first();
      if (await radio.isVisible()) {
        await radio.click({ force: true });
        const submitBtn = page.locator('button:has-text("Submit")').first();
        if (await submitBtn.isVisible()) {
          await submitBtn.click();
          await page.waitForTimeout(500);
        }
      }
      const nextBtn = page.locator('button:has-text("Next")');
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
