import { test, expect } from '@playwright/test';

test.describe('Update push — instance management', () => {
  test('update-manifest.json is served from web server', async ({ page }) => {
    const resp = await page.request.get('/update-manifest.json');
    expect(resp.ok()).toBe(true);
    const manifest = await resp.json();
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('bundleHash');
    expect(manifest).toHaveProperty('engines');
  });

  test('sw.js is served and contains version placeholder or injected version', async ({ page }) => {
    const resp = await page.request.get('/sw.js');
    expect(resp.ok()).toBe(true);
    const content = await resp.text();
    expect(content).toContain('CURRENT_VERSION');
  });
});
