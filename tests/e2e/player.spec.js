import { test, expect } from '@playwright/test';

test.describe('Player — content rendering', () => {
  test('renders a quiz via uid', async ({ page }) => {
    await page.goto('/player.html?uid=sample-quiz-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Quiz', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Start Quiz');
  });

  test('renders a flashcard via path', async ({ page }) => {
    await page.goto('/player.html?path=content/sample-flashcard.json');
    await expect(page.locator('body')).toContainText('Sample Cardiology Flashcards', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Start Studying');
    await expect(page.locator('body')).not.toContainText('Unable to load content');
  });
});
