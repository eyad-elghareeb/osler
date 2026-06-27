import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../dist');

test.describe('Update bundle', () => {
  test('dist/update-manifest.json exists with correct structure', async () => {
    const manifestPath = path.join(DIST_DIR, 'update-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('bundleHash');
    expect(manifest).toHaveProperty('engines');
    expect(manifest).toHaveProperty('generatedAt');
    expect(manifest.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.engines.length).toBe(11);
    expect(manifest.engines).not.toContain('sync-engine.js');
  });

  test('dist/sw.js has injected CURRENT_VERSION from manifest', async () => {
    const swPath = path.join(DIST_DIR, 'sw.js');
    expect(fs.existsSync(swPath)).toBe(true);

    const manifestPath = path.join(DIST_DIR, 'update-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const swContent = fs.readFileSync(swPath, 'utf-8');

    const versionMatch = swContent.match(/CURRENT_VERSION = '([^']+)'/);
    expect(versionMatch).not.toBeNull();
    expect(versionMatch[1]).toBe(manifest.version);
  });

  test('all engines listed in manifest exist on disk', async () => {
    const manifestPath = path.join(DIST_DIR, 'update-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    for (const engine of manifest.engines) {
      const enginePath = path.join(DIST_DIR, engine);
      expect(fs.existsSync(enginePath)).toBe(true);
      const stats = fs.statSync(enginePath);
      expect(stats.size).toBeGreaterThan(100);
    }
  });
});
