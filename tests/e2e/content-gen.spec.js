import { test, expect } from '@playwright/test';

test.describe('AI content generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/generativelanguage.googleapis.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  title: 'Generated Quiz',
                  questions: [{
                    id: 'gen-q-001',
                    question: 'What is the primary function of the left ventricle?',
                    options: ['Pump blood to the lungs', 'Pump blood to the body', 'Receive blood from the body', 'Filter blood', 'Store blood'],
                    correct: 1,
                    explanation: 'The left ventricle pumps oxygenated blood to the body via the aorta.',
                    tags: ['cardiology'],
                    difficulty: 2,
                  }],
                }),
              }],
            },
          }],
        }),
      });
    });
  });

  test('hub page loads for AI content generation', async ({ page }) => {
    await page.goto('/hub/index.html');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText('Osler', { timeout: 10000 });
  });

  test('quiz player renders correctly for validation', async ({ page }) => {
    await page.goto('/player.html?uid=sample-quiz-001');
    await expect(page.locator('body')).toContainText('Sample Cardiology Quiz', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Cardiology');
  });
});
